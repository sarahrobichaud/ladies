mod action;
mod progress;

pub use action::{Action, IllegalAction};
pub use progress::Street;

use super::HandState;

impl HandState {
    /// Plays `action` for the player whose turn it is and advances the hand.
    pub fn apply(&self, action: Action) -> Result<Self, IllegalAction> {
        let mut next = self.clone();
        let seat = next.to_act;

        action::apply_action(&mut next, seat, action)?;
        progress::advance_turn(&mut next, seat)?;

        Ok(next)
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    use std::str::FromStr;

    use ladies_core::Card;

    use super::Action;
    use crate::state::{Blinds, HandOptions, HandState, Street};

    pub(crate) const OPTIONS: HandOptions = HandOptions {
        button: 0,
        blinds: Blinds {
            small: 100,
            big: 200,
        },
    };

    /// Parses a single card, for rigging decks.
    pub(crate) fn card(s: &str) -> Card {
        Card::from_str(s).expect("valid card")
    }

    /// Calls the hand in preflop, then checks around each street until
    /// `target` is reached. The preflop round is closed with the BB's option,
    /// so the earliest reachable street is the flop.
    pub(crate) fn check_until(state: &HandState, target: Street) -> HandState {
        let mut state = state.apply(Action::Call).unwrap(); // UTG
        state = state.apply(Action::Call).unwrap(); // SB
        let state = state.apply(Action::Check).unwrap(); // BB's option closes the round

        check_around(&state, target)
    }

    /// Checks around each betting round until `target` is reached. Expects a
    /// closed round with no pending bet; works for any number of live players.
    pub(crate) fn check_around(state: &HandState, target: Street) -> HandState {
        let mut state = state.clone();

        while state.street < target {
            let street = state.street;
            state = state.apply(Action::Check).unwrap();
            while state.street == street {
                state = state.apply(Action::Check).unwrap();
            }
        }

        state
    }

    /// Aces, kings, queens in seat order, then a junk board — seat 0 wins
    pub(crate) fn aces_kings_queens_deck() -> Vec<Card> {
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

    /// Seats 0 and 2 hold equal pairs of aces, seat 1 kings — seats 0 and 2 split
    pub(crate) fn aces_kings_aces_deck() -> Vec<Card> {
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

    /// Kings, queens, aces, jacks in seat order, then a junk board; seat 2's
    /// aces beat the live kings and jacks
    pub(crate) fn kings_queens_aces_jacks_deck() -> Vec<Card> {
        vec![
            card("Ks"),
            card("Kh"), // seat 0: kings, best of the live players
            card("Qs"),
            card("Qh"), // seat 1: folds the SB, dead money
            card("As"),
            card("Ah"), // seat 2: aces, all-in for 150
            card("Js"),
            card("Jh"), // seat 3: jacks
            card("2c"),
            card("7d"),
            card("9c"),
            card("3s"),
            card("8h"), // junk board, no flush or straight possible
        ]
    }

    /// Seats 0 and 1 hold identical king-four hands over the paired board;
    /// seat 2's ace-queen loses
    pub(crate) fn tied_king_hands_deck() -> Vec<Card> {
        vec![
            card("Ks"),
            card("4d"), // seat 0: the board's pair of 2s, ace-king kickers
            card("Kh"),
            card("4h"), // seat 1: identical best five to seat 0
            card("Qs"),
            card("Jd"), // seat 2: ace-queen kickers lose
            card("Ac"),
            card("2c"),
            card("2d"),
            card("9c"),
            card("3s"), // paired board, hole cards avoid the three-club flush
        ]
    }
}
