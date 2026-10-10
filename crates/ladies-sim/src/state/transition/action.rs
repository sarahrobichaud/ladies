use std::fmt;

use crate::state::{Chips, Seat, player::Status};

use super::HandState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Fold,
    Call,
    Check,
    Raise { to: Chips },
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

/// Validates and applies one player's action: bets, statuses, and the
/// min-raise. Turn advancement happens in the progress module.
pub(super) fn apply_action(
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

#[cfg(test)]
mod fold_tests {
    use crate::state::{Action, HandState};

    use super::super::fixtures::OPTIONS;

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
}

#[cfg(test)]
mod call_tests {
    use crate::state::{Action, HandState, Street};

    use super::super::fixtures::OPTIONS;

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
}

#[cfg(test)]
mod check_tests {
    use crate::state::{Action, HandState, IllegalAction};

    use super::super::fixtures::OPTIONS;

    #[test]
    fn checking_when_facing_a_bet_is_illegal() {
        let state = HandState::new(1, &[5000; 3], OPTIONS); // UTG faces the BB's 200

        let result = state.apply(Action::Check);

        assert!(matches!(result, Err(IllegalAction::CheckFacingBet)));
    }
}

#[cfg(test)]
mod raise_tests {
    use crate::state::{Action, HandState, IllegalAction, Street};

    use super::super::fixtures::OPTIONS;

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
}
