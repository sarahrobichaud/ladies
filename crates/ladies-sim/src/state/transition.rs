mod action;
mod progress;

pub use action::{Action, ActionOptions, IllegalAction};
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

    /// The acting player's options, resolved by the same rules [`Action`
    /// enforcement](Self::apply) uses; `None` when no action is required.
    pub fn action_options(&self) -> Option<ActionOptions> {
        if self.street >= Street::Showdown {
            return None;
        }
        let player = &self.players[self.to_act];
        if !player.needs_action {
            return None;
        }

        let owed = self.current_bet.saturating_sub(player.bet);
        Some(ActionOptions {
            can_check: owed == 0,
            call_amount: owed.min(player.stack),
            can_raise: player.can_raise,
            min_raise_to: self.min_raise,
            max_raise_to: player.bet + player.stack,
        })
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    use std::collections::HashSet;
    use std::str::FromStr;

    use ladies_core::Card;

    use super::Action;
    use crate::state::{Blinds, Chips, HandOptions, HandState, Street};

    pub(crate) const OPTIONS: HandOptions = HandOptions {
        button: 0,
        blinds: Blinds {
            small: 100,
            big: 200,
        },
    };

    fn card(s: &str) -> Card {
        Card::from_str(s).expect("valid card")
    }

    /// Assembles a deck from two-card hole hands in seat order, then the
    /// board. Panics in debug builds if any card is repeated.
    pub(crate) fn deck(holes: &[(&str, &str)], board: &[&str]) -> Vec<Card> {
        let cards: Vec<Card> = holes
            .iter()
            .flat_map(|&(first, second)| [card(first), card(second)])
            .chain(board.iter().map(|s| card(s)))
            .collect();

        let unique: HashSet<_> = cards.iter().collect();
        debug_assert_eq!(
            unique.len(),
            cards.len(),
            "rigged decks must not repeat cards"
        );

        cards
    }

    /// Deals a fresh hand from a rigged deck, checking the deck supplies two
    /// hole cards per player and the five-card board.
    pub(crate) fn deal(deck: Vec<Card>, stacks: &[Chips]) -> HandState {
        assert_eq!(
            deck.len(),
            stacks.len() * 2 + 5,
            "deck must supply two hole cards per player and the board"
        );

        HandState::from_deck(deck, stacks, OPTIONS)
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

    /// Asserts the hand completed cleanly: paid out, pot swept.
    pub(crate) fn assert_settled(state: &HandState, stacks: &[Chips]) {
        assert!(state.is_hand_over());
        assert_eq!(state.pot(), 0);
        assert_eq!(state.stacks(), stacks);
    }

    /// A fresh heads-up hand: seat 0 is the button and posts the small blind.
    pub(crate) fn heads_up() -> HandState {
        HandState::new(1, &[5000, 5000], OPTIONS)
    }

    /// A heads-up hand dealt from a rigged deck.
    pub(crate) fn heads_up_dealt(deck: Vec<Card>) -> HandState {
        deal(deck, &[5000, 5000])
    }

    /// Aces, kings, queens in seat order, then a junk board — seat 0 wins
    pub(crate) fn aces_kings_queens_deck() -> Vec<Card> {
        deck(
            &[("As", "Ah"), ("Ks", "Kh"), ("Qs", "Qh")],
            &["2c", "7d", "9c", "3s", "8h"],
        )
    }

    /// Seats 0 and 2 hold equal pairs of aces, seat 1 kings — seats 0 and 2 split
    pub(crate) fn aces_kings_aces_deck() -> Vec<Card> {
        deck(
            &[("As", "Ah"), ("Ks", "Kh"), ("Ad", "Ac")],
            &["2c", "7d", "9c", "3s", "8h"],
        )
    }

    /// Kings, queens, aces, jacks in seat order, then a junk board; seat 2's
    /// aces beat the live kings and jacks
    pub(crate) fn kings_queens_aces_jacks_deck() -> Vec<Card> {
        deck(
            &[("Ks", "Kh"), ("Qs", "Qh"), ("As", "Ah"), ("Js", "Jh")],
            &["2c", "7d", "9c", "3s", "8h"],
        )
    }

    /// Seats 0 and 1 hold identical king-four hands over the paired board;
    /// seat 2's ace-queen loses
    pub(crate) fn tied_king_hands_deck() -> Vec<Card> {
        deck(
            &[("Ks", "4d"), ("Kh", "4h"), ("Qs", "Jd")],
            &["Ac", "2c", "2d", "9c", "3s"],
        )
    }

    /// Aces versus kings, then a junk board — seat 0 wins
    pub(crate) fn aces_kings_deck() -> Vec<Card> {
        deck(
            &[("As", "Ah"), ("Ks", "Kh")],
            &["2c", "7d", "9c", "3s", "8h"],
        )
    }
}
