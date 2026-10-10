use std::{
    collections::{HashMap, hash_map::Entry},
    fmt,
};

use ladies_core::{Card, Hand, HandValue, evaluate};

use super::HandState;
use crate::state::{Chips, Seat, player::Status};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Fold,
    Call,
    Check,
    Raise { to: Chips },
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Street {
    Preflop,
    Flop,
    Turn,
    River,
    Showdown,
    Complete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IllegalAction {
    CheckFacingBet,
    RaiseBelowMinRaise { min: Chips },
}

impl fmt::Display for IllegalAction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CheckFacingBet => write!(f, "cannot check when facing a bet"),
            Self::RaiseBelowMinRaise { min } => write!(f, "raise must reach at least {min}"),
        }
    }
}

impl std::error::Error for IllegalAction {}

impl HandState {
    pub fn apply(&self, action: Action) -> Result<Self, IllegalAction> {
        let mut next = self.clone();
        let seat = next.to_act;

        apply_action(&mut next, seat, action)?;
        advance_turn(&mut next, seat)?;

        Ok(next)
    }
}

fn apply_action(
    mutation: &mut HandState,
    seat: Seat,
    action: Action,
) -> Result<&HandState, IllegalAction> {
    let subject = &mut mutation.players[seat];
    let owed = mutation.current_bet - subject.bet;

    let mut reopens = false;

    match action {
        Action::Fold => {
            subject.status = Status::Folded;
        }
        Action::Call => {
            subject.post(owed);
        }
        Action::Check => {
            if subject.bet < mutation.current_bet {
                return Err(IllegalAction::CheckFacingBet);
            }
        }
        Action::Raise { to } => {
            if to < mutation.min_raise {
                return Err(IllegalAction::RaiseBelowMinRaise {
                    min: mutation.min_raise,
                });
            }

            let added = to - subject.bet;
            subject.post(added);
            mutation.min_raise = to + (to - mutation.current_bet);
            mutation.current_bet = to;
            reopens = true;
        }
    }

    subject.needs_action = false;

    if reopens {
        for (s, p) in &mut mutation.players.iter_mut().enumerate() {
            if s != seat && p.can_play() {
                p.needs_action = true
            }
        }
    }

    Ok(mutation)
}

fn advance_turn(mutation: &mut HandState, seat: Seat) -> Result<&HandState, IllegalAction> {
    mutation.to_act = super::next_active_from(seat, &mutation.players);

    if is_fold_win(mutation) {
        award_pot(mutation);
        mutation.street = Street::Complete;
    } else if is_round_closed(mutation) {
        advance_street(mutation);
    }

    Ok(mutation)
}

fn is_fold_win(state: &HandState) -> bool {
    state.players.iter().filter(|p| p.can_play()).count() == 1
}

fn is_round_closed(state: &HandState) -> bool {
    if !state.players.iter().any(|p| p.can_play()) {
        todo!("Implement all-in runout");
    }

    state
        .players
        .iter()
        .filter(|p| p.can_play())
        .all(|p| !p.needs_action)
}

fn advance_street(mutation: &mut HandState) {
    if mutation.street == Street::River {
        award_showdown(mutation);
        mutation.street = Street::Complete;
        return;
    }

    for p in &mut mutation.players {
        p.bet = 0; // committed is kept
    }

    mutation.current_bet = 0;
    mutation.min_raise = mutation.blinds.big;

    let (dealt, next_street) = match mutation.street {
        Street::Preflop => (3, Street::Flop),
        Street::Flop => (1, Street::Turn),
        Street::Turn => (1, Street::River),
        Street::River | Street::Showdown | Street::Complete => {
            unreachable!("advance_street only runs on live betting streets")
        }
    };

    let cards: Vec<Card> = mutation.deck.drain(..dealt).collect();
    mutation.board.extend(cards);
    mutation.street = next_street;

    mutation.to_act = super::next_active_from(mutation.positions.button, &mutation.players);
    for p in &mut mutation.players {
        p.needs_action = p.can_play();
    }
}

fn award_showdown(mutation: &mut HandState) {
    let pot: Chips = mutation.players.iter().map(|p| p.committed).sum();

    let mut results: HashMap<HandValue, Vec<Seat>> = HashMap::new();
    let mut winner: Option<(Seat, ladies_core::HandValue)> = None;
    for (seat, player) in mutation.players.iter().enumerate() {
        if !player.can_win_pot() {
            continue;
        }

        let cards: Vec<Card> = player
            .hole
            .iter()
            .copied()
            .chain(mutation.board.iter().copied())
            .collect();
        let hand = Hand::new(cards).expect("hole + board are seven distinct cards");
        let value = evaluate(&hand);

        match results.entry(value) {
            Entry::Vacant(e) => {
                e.insert(vec![seat]);
            }
            Entry::Occupied(mut e) => {
                e.get_mut().push(seat);
            }
        }

        if winner.as_ref().is_none_or(|(_, best)| value > *best) {
            winner = Some((seat, value));
        }
    }

    let best_hand = results
        .keys()
        .max()
        .copied()
        .expect("Theres should be at least one hand during showdown");

    let winners: Vec<(Seat, HandValue)> = results[&best_hand]
        .iter()
        .map(|&s| (s, best_hand))
        .collect();

    let pot = pot / winners.len() as u64;
    for (seat, _) in winners {
        mutation.players[seat].stack += pot;
    }

    for p in &mut mutation.players {
        p.committed = 0;
        p.bet = 0;
    }
}

fn award_pot(mutation: &mut HandState) {
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
    use std::{collections::HashSet, str::FromStr};

    use ladies_core::Card;

    use super::{Action, IllegalAction, Street};
    use crate::state::{Blinds, HandOptions, HandState};

    const OPTIONS: HandOptions = HandOptions {
        button: 0,
        blinds: Blinds {
            small: 100,
            big: 200,
        },
    };

    #[test]
    fn fold_puts_a_player_out_of_play() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);
        let utg = state.to_act;

        let next = state.apply(Action::Fold).unwrap();

        assert!(!next.players[utg].can_play());
        assert!(!next.players[utg].needs_action);
    }

    #[test]
    fn fold_passes_action_to_the_next_player() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);

        let next = state.apply(Action::Fold).unwrap();

        assert_eq!(next.to_act, state.positions.sb);
    }

    #[test]
    fn folding_around_ends_the_hand() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);

        let state = state.apply(Action::Fold).unwrap();
        let state = state.apply(Action::Fold).unwrap();

        assert!(state.is_hand_over())
    }

    #[test]
    fn last_player_standing_wins_the_pot() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);

        let state = state.apply(Action::Fold).unwrap(); // UTG
        let state = state.apply(Action::Fold).unwrap(); // SB

        let bb = state.positions.bb;

        assert_eq!(state.players[bb].stack, 5100);
        assert_eq!(state.pot(), 0);
    }

    #[test]
    fn a_call_matches_the_current_bet() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);
        let utg = state.to_act;

        let next = state.apply(Action::Call).unwrap();

        let caller = &next.players[utg];
        assert_eq!(caller.bet, OPTIONS.blinds.big); // matched the BB's 200
        assert_eq!(caller.stack, 5000 - OPTIONS.blinds.big);
        assert!(!caller.needs_action);
        assert_eq!(next.to_act, next.positions.sb); // action moves on
    }

    #[test]
    fn checking_when_facing_a_bet_is_illegal() {
        let state = HandState::new(1, &[5000; 3], OPTIONS); // UTG faces the BB's 200

        let result = state.apply(Action::Check);

        assert!(matches!(result, Err(IllegalAction::CheckFacingBet)));
    }

    #[test]
    fn a_call_when_owing_nothing_bets_nothing() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);
        let state = state.apply(Action::Call).unwrap(); // UTG calls (owed 200)
        let state = state.apply(Action::Call).unwrap(); // SB calls (owed 100)
        let bb = state.positions.bb;

        let next = state.apply(Action::Call).unwrap();

        assert_eq!(next.street, Street::Flop);
        assert_eq!(next.players[bb].committed, OPTIONS.blinds.big);
        assert_eq!(next.players[bb].stack, 5000 - OPTIONS.blinds.big);
    }

    #[test]
    fn the_bb_option_closes_the_preflop_round() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);
        let state = state.apply(Action::Call).unwrap(); // UTG
        let state = state.apply(Action::Call).unwrap(); // SB

        let next = state.apply(Action::Check).unwrap(); // BB's option closes the round

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
        let state = HandState::new(1, &[5000; 3], OPTIONS);

        // preflop: call, call, BB's check closes the round → flop
        let state = state.apply(Action::Call).unwrap();
        let state = state.apply(Action::Call).unwrap();
        let state = state.apply(Action::Check).unwrap();

        assert_eq!(state.street, Street::Flop);
        assert_eq!(state.board.len(), 3);
        assert_eq!(state.to_act, state.positions.sb);

        // flop: SB, BB, button all check → turn
        let state = state.apply(Action::Check).unwrap();
        let state = state.apply(Action::Check).unwrap();
        let state = state.apply(Action::Check).unwrap();

        assert_eq!(state.street, Street::Turn);
        assert_eq!(state.board.len(), 4);

        // turn: all three check → river
        let state = state.apply(Action::Check).unwrap();
        let state = state.apply(Action::Check).unwrap();
        let state = state.apply(Action::Check).unwrap();

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

    /// Parses a single card, for rigging decks.
    fn card(s: &str) -> Card {
        Card::from_str(s).expect("valid card")
    }

    fn walk_to_river(state: &HandState) -> HandState {
        let state = state.apply(Action::Call).unwrap(); // UTG
        let state = state.apply(Action::Call).unwrap(); // SB
        let state = state.apply(Action::Check).unwrap(); // BB — flop

        let state = state.apply(Action::Check).unwrap(); // SB
        let state = state.apply(Action::Check).unwrap(); // BB
        let state = state.apply(Action::Check).unwrap(); // button — turn

        let state = state.apply(Action::Check).unwrap(); // SB
        let state = state.apply(Action::Check).unwrap(); // BB
        state.apply(Action::Check).unwrap()
    }

    /// Aces, kings, queens in seat order, then a junk board — seat 0 wins
    fn rigged_deck() -> Vec<Card> {
        vec![
            card("As"),
            card("Ah"), // seat 0 — aces
            card("Ks"),
            card("Kh"), // seat 1 — kings
            card("Qs"),
            card("Qh"), // seat 2 — queens
            card("2c"),
            card("7d"),
            card("9c"),
            card("3s"),
            card("8h"), // junk board — no flush or straight possible
        ]
    }

    #[test]
    fn the_best_hand_wins_at_showdown() {
        let state = HandState::from_deck(rigged_deck(), &[5000; 3], OPTIONS);
        let state = walk_to_river(&state);

        let state = state.apply(Action::Check).unwrap();
        let state = state.apply(Action::Check).unwrap();
        let next = state.apply(Action::Check).unwrap();

        assert_eq!(next.street, Street::Complete);
        assert!(next.is_hand_over());
        assert_eq!(next.players[0].stack, 5400); // aces beat kings and queens — 4800 + 600 pot
        assert_eq!(next.players[1].stack, 4800);
        assert_eq!(next.players[2].stack, 4800);
        assert_eq!(next.pot(), 0);
    }

    #[test]
    fn a_folded_player_is_excluded_from_showdown() {
        let state = HandState::from_deck(rigged_deck(), &[5000; 3], OPTIONS);
        let state = walk_to_river(&state);

        let state = state.apply(Action::Check).unwrap();
        let state = state.apply(Action::Check).unwrap();
        let next = state.apply(Action::Fold).unwrap();

        assert_eq!(next.street, Street::Complete);
        assert!(next.is_hand_over());
        assert_eq!(next.players[0].stack, 4800); // aces, but folded — excluded
        assert_eq!(next.players[1].stack, 5400); // kings beat queens — 4800 + 600 pot
        assert_eq!(next.players[2].stack, 4800);
        assert_eq!(next.pot(), 0);
    }

    #[test]
    fn an_all_in_player_still_shows_down() {
        // seat 0 holds the aces with exactly the BB's 200, so no sidepot
        let state = HandState::from_deck(rigged_deck(), &[200, 5000, 5000], OPTIONS);

        let state = state.apply(Action::Call).unwrap();
        assert!(!state.players[0].can_play()); // can't act anymore
        assert!(state.players[0].can_win_pot()); // but still eligible to win

        let state = state.apply(Action::Call).unwrap(); // SB
        let state = state.apply(Action::Check).unwrap(); // BB — flop

        // flop, turn, river: SB and BB check around; the all-in player sits out
        let state = state.apply(Action::Check).unwrap();
        let state = state.apply(Action::Check).unwrap(); // → turn

        let state = state.apply(Action::Check).unwrap();
        let state = state.apply(Action::Check).unwrap(); // → river

        let state = state.apply(Action::Check).unwrap();
        let state = state.apply(Action::Check).unwrap(); // → showdown

        assert_eq!(state.street, Street::Complete);
        assert!(state.is_hand_over());
        assert_eq!(state.players[0].stack, 600); // aces win the whole pot — all-in for exactly
        assert_eq!(state.players[1].stack, 4800);
        assert_eq!(state.players[2].stack, 4800);
        assert_eq!(state.pot(), 0);
    }

    #[test]
    fn a_raise_sets_the_current_bet() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);
        let utg = state.to_act;

        let next = state.apply(Action::Raise { to: 600 }).unwrap();

        let raiser = &next.players[utg];
        assert_eq!(raiser.bet, 600);
        assert_eq!(raiser.stack, 5000 - 600);
        assert_eq!(next.current_bet, 600);
        assert!(!next.players[utg].needs_action);
        assert_eq!(next.to_act, next.positions.sb); // action moves on
    }

    #[test]
    fn a_raise_reopens_action_for_players_who_already_acted() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);
        let state = state.apply(Action::Call).unwrap(); // UTG — flag cleared
        let state = state.apply(Action::Call).unwrap(); // SB — flag cleared
        let bb = state.positions.bb;

        let next = state.apply(Action::Raise { to: 600 }).unwrap();

        assert!(next.players[0].needs_action); // UTG must respond to the raise
        assert!(next.players[1].needs_action); // SB must respond to the raise
        assert!(!next.players[bb].needs_action); // the raiser has acted
        assert_eq!(next.current_bet, 600);
    }

    #[test]
    fn a_raise_below_the_minimum_is_illegal() {
        let state = HandState::new(1, &[5000; 3], OPTIONS); // min raise-to is 400

        let result = state.apply(Action::Raise { to: 300 });

        assert!(matches!(
            result,
            Err(IllegalAction::RaiseBelowMinRaise { min: 400 })
        ));
    }

    #[test]
    fn a_raise_at_the_minimum_is_legal() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);

        let next = state.apply(Action::Raise { to: 400 }).unwrap();

        assert_eq!(next.current_bet, 400);
    }

    #[test]
    fn a_raise_updates_the_minimum_for_the_next_raise() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);
        let state = state.apply(Action::Raise { to: 600 }).unwrap();

        assert_eq!(state.min_raise, 1000); // 600 + the 400 increment

        let result = state.apply(Action::Raise { to: 800 }); // below the new minimum

        assert!(matches!(
            result,
            Err(IllegalAction::RaiseBelowMinRaise { min: 1000 })
        ));
    }

    #[test]
    fn the_minimum_resets_at_each_street() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);
        // preflop: raise to 600, called around — min_raise is 1000 going into the flop
        let state = state.apply(Action::Raise { to: 600 }).unwrap();
        let state = state.apply(Action::Call).unwrap(); // SB
        let state = state.apply(Action::Call).unwrap(); // BB — closes the round

        assert_eq!(state.street, Street::Flop);
        assert_eq!(state.min_raise, OPTIONS.blinds.big); // reset — a bet of 200 is legal again

        let next = state.apply(Action::Raise { to: 200 }).unwrap(); // SB bets the minimum

        assert_eq!(next.current_bet, 200);
        assert_eq!(next.min_raise, 400); // the update rule applies postflop too
    }

    #[test]
    fn the_initial_bet_requirement_survives_a_short_blind_bet() {
        let state = HandState::new(1, &[5000, 5000, 50], OPTIONS); // BB all-in for 50

        assert_eq!(state.players[2].bet, 50); // the short post
        assert_eq!(state.players[2].stack, 0); // all-in
        assert!(state.players[2].can_win_pot()); // but still eligible
        assert_eq!(state.current_bet, OPTIONS.blinds.big); // the requirement survives

        let next = state.apply(Action::Call).unwrap(); // UTG calls the full 200
        let next = next.apply(Action::Call).unwrap(); // SB — the old underflow site;

        assert_eq!(next.street, Street::Flop);
        assert_eq!(next.players[0].committed, OPTIONS.blinds.big);
        assert_eq!(next.players[1].committed, OPTIONS.blinds.big);
    }

    /// Seats 0 and 2 hold equal pairs of aces, seat 1 kings — seats 0 and 2 split
    fn equalHandDeck() -> Vec<Card> {
        vec![
            card("As"),
            card("Ah"), // seat 0 — aces
            card("Ks"),
            card("Kh"), // seat 1 — kings
            card("Ad"),
            card("Ac"), // seat 2 — aces, equal to seat 0
            card("2c"),
            card("7d"),
            card("9c"),
            card("3s"),
            card("8h"), // junk board — no flush or straight possible
        ]
    }

    #[test]
    fn pot_splits_when_best_hands_are_equal() {
        let state = HandState::from_deck(equalHandDeck(), &[5000; 3], OPTIONS);
        let state = walk_to_river(&state);
        assert_eq!(state.pot(), 600);

        let state = state.apply(Action::Check).unwrap();
        let state = state.apply(Action::Check).unwrap();
        let next = state.apply(Action::Check).unwrap();

        assert_eq!(next.street, Street::Complete);

        assert!(next.is_hand_over());
        assert_eq!(next.players[0].stack, 5100); // aces split the pot — 4800 + 300
        assert_eq!(next.players[1].stack, 4800); // kings lose
        assert_eq!(next.players[2].stack, 5100); // aces split the pot — 4800 + 300
        assert_eq!(next.pot(), 0);
    }
}
