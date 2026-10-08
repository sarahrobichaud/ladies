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

    match action {
        Action::Fold => {
            subject.status = Status::Folded;
            subject.needs_action = false;
        }
    }

    Ok(mutation)
}

fn advance_turn(mutation: &mut GameState, seat: Seat) -> Result<&GameState, TransitionError> {
    mutation.to_act = super::next_active_from(seat, &mutation.players);

    if is_fold_win(mutation) {
        award_pot(mutation);
        mutation.street = Street::Complete;
    }

    Ok(mutation)
}

fn is_fold_win(state: &GameState) -> bool {
    state.players.iter().filter(|p| p.can_play()).count() == 1
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
    use crate::state::{Blinds, GameState, GameStateInitOptions, action::Action};

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
}
