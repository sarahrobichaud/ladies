use ladies_core::Card;

use crate::state::Chips;
use crate::state::Seat;
use crate::state::Street;
use crate::state::player::Status;

use super::GameState;
use super::action::Action;

#[derive(Debug)]
pub enum TransitionError {
    IllegalAction { reason: &'static str },
}

impl GameState {
    pub fn step_with(&self, action: Action) -> Result<Self, TransitionError> {
        let mut next = self.clone();
        let seat = next.to_act;

        apply_action(&mut next, seat, action)?;
        advance_turn(&mut next, seat)?;

        Ok(next)
    }
}

fn apply_action(
    mutation: &mut GameState,
    seat: Seat,
    action: Action,
) -> Result<&GameState, TransitionError> {
    let subject = &mut mutation.players[seat];
    let owed = mutation.current_bet - subject.bet;

    match action {
        Action::Fold => {
            subject.status = Status::Folded;
        }
        Action::Call => {
            subject.post(owed);
        }
        Action::Check => {
            if subject.bet < mutation.current_bet {
                return Err(TransitionError::IllegalAction {
                    reason: "Cannot check when facing a bet",
                });
            }
        }
    }

    subject.needs_action = false;
    Ok(mutation)
}

fn advance_turn(mutation: &mut GameState, seat: Seat) -> Result<&GameState, TransitionError> {
    mutation.to_act = super::next_active_from(seat, &mutation.players);

    if is_fold_win(mutation) {
        award_pot(mutation);
        mutation.street = Street::Complete;
    } else if is_round_closed(mutation) {
        advance_street(mutation);
    }

    Ok(mutation)
}

fn is_fold_win(state: &GameState) -> bool {
    state.players.iter().filter(|p| p.can_play()).count() == 1
}

fn is_round_closed(state: &GameState) -> bool {
    if !state.players.iter().any(|p| p.can_play()) {
        todo!("Implement all-in runout");
    }

    state
        .players
        .iter()
        .filter(|p| p.can_play())
        .all(|p| !p.needs_action)
}

fn advance_street(mutation: &mut GameState) {
    for p in &mut mutation.players {
        p.bet = 0; // commited is kept
    }

    mutation.current_bet = 0;

    let (dealt, next_street) = match mutation.street {
        Street::Preflop => (3, Street::Flop),
        Street::Flop => (1, Street::Turn),
        Street::Turn => (1, Street::River),
        Street::River => todo!("showdown"),
        Street::Showdown | Street::Complete => todo!("showdown handling"),
    };

    let cards: Vec<Card> = mutation.deck.drain(..dealt).collect();
    mutation.board.extend(cards);
    mutation.street = next_street;

    mutation.to_act = super::next_active_from(mutation.positions.button, &mutation.players);
    for p in &mut mutation.players {
        p.needs_action = p.can_play();
    }
}

fn award_pot(mutation: &mut GameState) {
    let pot: Chips = mutation.players.iter().map(|p| p.committed).sum();
    let winner = mutation
        .players
        .iter_mut()
        .find(|p| p.can_play())
        .expect("fold win implies exactly one active player");
    winner.stack += pot;

    for p in &mut mutation.players {
        p.committed = 0;
        p.bet = 0;
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use ladies_core::Card;

    use crate::{
        Street,
        state::{Blinds, GameState, GameStateInitOptions, TransitionError, action::Action},
    };

    const OPTIONS: GameStateInitOptions = GameStateInitOptions {
        button: 0,
        blinds: Blinds {
            small: 100,
            big: 200,
        },
    };

    #[test]
    fn fold_puts_a_player_out_of_play() {
        let state = GameState::new(1, &[5000; 3], OPTIONS);
        let utg = state.to_act;

        let next = state.step_with(Action::Fold).unwrap();

        assert!(!next.players[utg].can_play());
        assert!(!next.players[utg].needs_action);
    }

    #[test]
    fn fold_passes_action_to_the_next_player() {
        let state = GameState::new(1, &[5000; 3], OPTIONS);

        let next = state.step_with(Action::Fold).unwrap();

        assert_eq!(next.to_act, state.positions.sb);
    }

    #[test]
    fn folding_around_ends_the_hand() {
        let state = GameState::new(1, &[5000; 3], OPTIONS);

        let state = state.step_with(Action::Fold).unwrap();
        let state = state.step_with(Action::Fold).unwrap();

        assert!(state.is_hand_over())
    }

    #[test]
    fn last_player_standing_wins_the_pot() {
        let state = GameState::new(1, &[5000; 3], OPTIONS);

        let state = state.step_with(Action::Fold).unwrap(); // UTG
        let state = state.step_with(Action::Fold).unwrap(); // SB

        let bb = state.positions.bb;

        assert_eq!(state.players[bb].stack, 5100);
        assert_eq!(state.pot(), 0);
    }

    #[test]
    fn a_call_matches_the_current_bet() {
        let state = GameState::new(1, &[5000; 3], OPTIONS);
        let utg = state.to_act;

        let next = state.step_with(Action::Call).unwrap();

        let caller = &next.players[utg];
        assert_eq!(caller.bet, OPTIONS.blinds.big); // matched the BB's 200
        assert_eq!(caller.stack, 5000 - OPTIONS.blinds.big);
        assert!(!caller.needs_action);
        assert_eq!(next.to_act, next.positions.sb); // action moves on
    }

    #[test]
    fn checking_when_facing_a_bet_is_illegal() {
        let state = GameState::new(1, &[5000; 3], OPTIONS); // UTG faces the BB's 200

        let result = state.step_with(Action::Check);

        assert!(matches!(result, Err(TransitionError::IllegalAction { .. })));
    }

    #[test]
    fn a_call_when_owing_nothing_bets_nothing() {
        let state = GameState::new(1, &[5000; 3], OPTIONS);
        let state = state.step_with(Action::Call).unwrap(); // UTG calls (owed 200)
        let state = state.step_with(Action::Call).unwrap(); // SB calls (owed 100)
        let bb = state.positions.bb;

        let next = state.step_with(Action::Call).unwrap();

        assert_eq!(next.street, Street::Flop);
        assert_eq!(next.players[bb].committed, OPTIONS.blinds.big);
        assert_eq!(next.players[bb].stack, 5000 - OPTIONS.blinds.big);
    }

    #[test]
    fn the_bb_option_closes_the_preflop_round() {
        let state = GameState::new(1, &[5000; 3], OPTIONS);
        let state = state.step_with(Action::Call).unwrap(); // UTG
        let state = state.step_with(Action::Call).unwrap(); // SB

        let next = state.step_with(Action::Check).unwrap(); // BB's option closes the round

        assert_eq!(next.street, Street::Flop);
        assert_eq!(next.board.len(), 3);
        assert_eq!(next.current_bet, 0);
        assert_eq!(next.to_act, next.positions.sb); // first active left of the button
        assert_eq!(next.pot(), 600); // sweep moves nothing

        for player in &next.players {
            assert_eq!(player.bet, 0); // bets swept
            assert_eq!(player.needs_action, player.can_play()); // fresh round
        }
    }

    #[test]
    fn a_checked_around_hand_reaches_the_river() {
        let state = GameState::new(1, &[5000; 3], OPTIONS);

        // preflop: call, call, BB's check closes the round → flop
        let state = state.step_with(Action::Call).unwrap();
        let state = state.step_with(Action::Call).unwrap();
        let state = state.step_with(Action::Check).unwrap();

        assert_eq!(state.street, Street::Flop);
        assert_eq!(state.board.len(), 3);
        assert_eq!(state.to_act, state.positions.sb);

        // flop: SB, BB, button all check → turn
        let state = state.step_with(Action::Check).unwrap();
        let state = state.step_with(Action::Check).unwrap();
        let state = state.step_with(Action::Check).unwrap();

        assert_eq!(state.street, Street::Turn);
        assert_eq!(state.board.len(), 4);

        // turn: all three check → river
        let state = state.step_with(Action::Check).unwrap();
        let state = state.step_with(Action::Check).unwrap();
        let state = state.step_with(Action::Check).unwrap();

        assert_eq!(state.street, Street::River);
        assert_eq!(state.board.len(), 5);

        let all: HashSet<Card> = state
            .players
            .iter()
            .flat_map(|p| p.hole)
            .chain(state.board.iter().copied())
            .chain(state.deck.iter().copied())
            .collect();

        assert_eq!(all.len(), 52);
        assert_eq!(state.deck.len(), 41); // 52 − 6 holes − 5 board
    }
}
