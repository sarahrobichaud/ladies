use std::fmt;

use crate::state::{Chips, Player, Seat, player::Status};

use super::HandState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Fold,
    Call,
    Check,
    /// Bets or raises to a total level: a full raise the player can
    /// afford. A shove is [`Action::AllIn`].
    Raise {
        to: Chips,
    },
    /// Shoves everything. The stack decides what it turns out to be:
    /// an all-in call for less, an incomplete raise, or a full raise.
    AllIn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IllegalAction {
    PlayerCannotAct,
    CheckFacingBet,
    RaiseBelowMinRaise { min: Chips },
    RaiseExceedsStack { max: Chips },
    RaiseNotReopened,
}

impl fmt::Display for IllegalAction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PlayerCannotAct => {
                write!(f, "this player cannot act")
            }
            Self::CheckFacingBet => write!(f, "cannot check when facing a bet"),
            Self::RaiseBelowMinRaise { min } => write!(f, "raise must reach at least {min}"),
            Self::RaiseExceedsStack { max } => {
                write!(
                    f,
                    "raise exceeds the stack; the most you can raise to is {max}"
                )
            }
            Self::RaiseNotReopened => {
                write!(f, "cannot raise; the betting was not reopened")
            }
        }
    }
}

impl std::error::Error for IllegalAction {}

/// What the player whose turn it is may do, resolved by the same rules
/// [`Action`] enforcement uses, so a UI can offer exactly the legal moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActionOptions {
    /// Whether checking is legal: the player's bet already matches the
    /// current bet.
    pub can_check: bool,
    /// What a call would post: the owed amount, clamped to the stack, so a
    /// short stack's call is the all-in call it actually is.
    pub call_amount: Chips,
    /// Whether raising is legal: betting was reopened for this player.
    pub can_raise: bool,
    /// Minimum total raise-to level, not an increment.
    pub min_raise_to: Chips,
    /// Largest total raise-to level: the player's bet plus their stack.
    pub max_raise_to: Chips,
}

/// One action, fully resolved against the current state: validation has
/// passed and every amount is exact.
enum Resolved {
    /// The player is out of the hand.
    Fold,
    /// The bet already matches: nothing is posted, nothing is granted.
    Check,
    /// Matching the current bet with `added` chips, all-in when the
    /// stack can't cover the whole owed amount.
    Call { added: Chips },
    /// An all-in above the bet but short of a full raise: the bet goes
    /// up to `to` and the minimum re-bases on it, but betting isn't
    /// reopened.
    Incomplete {
        added: Chips,
        to: Chips,
        min_raise_to: Chips,
    },
    /// A full bet or raise to `to`: reopens betting and resets the
    /// minimum raise-to.
    Full {
        added: Chips,
        to: Chips,
        min_raise_to: Chips,
    },
}

/// Plays `action` for the player whose turn it is. The rules live in
/// [`resolve`]; this applies the resolved effects.
pub(super) fn apply_action(
    mutation: &mut HandState,
    seat: Seat,
    action: Action,
) -> Result<&HandState, IllegalAction> {
    if !mutation.players[seat].can_play() {
        return Err(IllegalAction::PlayerCannotAct);
    }

    let resolved = resolve(mutation, seat, action)?;

    match resolved {
        Resolved::Fold => mutation.players[seat].status = Status::Folded,
        Resolved::Check => {}
        Resolved::Call { added } => mutation.players[seat].post(added),
        // Both raises move the bet and re-base the minimum on it; the
        // only difference is that a full raise reopens betting, which
        // grant_others decides.
        Resolved::Incomplete {
            added,
            to,
            min_raise_to,
        }
        | Resolved::Full {
            added,
            to,
            min_raise_to,
        } => {
            mutation.players[seat].post(added);
            mutation.current_bet = to;
            mutation.min_raise = min_raise_to;
        }
    }

    // Acting forfeits raise rights until another player reopens betting.
    let subject = &mut mutation.players[seat];
    subject.can_raise = false;
    subject.needs_action = false;

    grant_others(mutation, seat, &resolved);

    Ok(mutation)
}

/// Validates `action` for `seat` and resolves it into exact effects.
fn resolve(state: &HandState, seat: Seat, action: Action) -> Result<Resolved, IllegalAction> {
    let player = &state.players[seat];

    // Invariant: nobody can have bet more than the current bet (it is
    // the table's maximum posted bet), so every `current_bet - bet`
    // below is a real owed amount.
    debug_assert!(player.bet <= state.current_bet);

    match action {
        Action::Fold => Ok(Resolved::Fold),

        Action::Check => {
            if player.bet < state.current_bet {
                return Err(IllegalAction::CheckFacingBet);
            }

            Ok(Resolved::Check)
        }

        Action::Call => Ok(Resolved::Call {
            added: (state.current_bet - player.bet).min(player.stack),
        }),

        Action::Raise { to } => resolve_raise(state, player, to),
        Action::AllIn => resolve_all_in(state, player),
    }
}

/// A full bet or raise to an exact level: affordable, reopened, and at
/// least the minimum.
fn resolve_raise(state: &HandState, player: &Player, to: Chips) -> Result<Resolved, IllegalAction> {
    let max_to = player.bet + player.stack;

    if to > max_to {
        return Err(IllegalAction::RaiseExceedsStack { max: max_to });
    }
    if !player.can_raise {
        return Err(IllegalAction::RaiseNotReopened);
    }
    if to < state.min_raise {
        return Err(IllegalAction::RaiseBelowMinRaise {
            min: state.min_raise,
        });
    }

    Ok(Resolved::Full {
        added: to - player.bet,
        to,
        min_raise_to: to + (to - state.current_bet),
    })
}

/// Shoving everything: the stack decides between an all-in call for
/// less, an incomplete raise, and a full raise.
fn resolve_all_in(state: &HandState, player: &Player) -> Result<Resolved, IllegalAction> {
    let to = player.bet + player.stack;

    if to <= state.current_bet {
        // The stack can't reach the bet: the shove is the all-in call
        // it actually is.
        return Ok(Resolved::Call {
            added: player.stack,
        });
    }
    if !player.can_raise {
        return Err(IllegalAction::RaiseNotReopened);
    }
    if to >= state.min_raise {
        return Ok(Resolved::Full {
            added: player.stack,
            to,
            min_raise_to: to + (to - state.current_bet),
        });
    }

    // Above the bet but short of a full raise: legal, but incomplete.
    // The bet goes up and re-bases the minimum, but betting isn't reopened.
    Ok(Resolved::Incomplete {
        added: player.stack,
        to,
        min_raise_to: to + (state.min_raise - state.current_bet),
    })
}

/// Offers the other active players a decision on the new bet; a full
/// raise also restores their raise rights. A fold, check, or call
/// leaves them untouched.
fn grant_others(mutation: &mut HandState, seat: Seat, resolved: &Resolved) {
    let raise_rights = match resolved {
        Resolved::Fold | Resolved::Check | Resolved::Call { .. } => return,
        Resolved::Incomplete { .. } => false,
        Resolved::Full { .. } => true,
    };

    for (s, p) in mutation.players.iter_mut().enumerate() {
        if s != seat && p.can_play() {
            p.needs_action = true;
            p.can_raise |= raise_rights;
        }
    }
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
mod turn_tests {
    use crate::state::{Action, HandState, IllegalAction, Street};

    use super::super::fixtures::OPTIONS;

    #[test]
    fn a_folded_player_cannot_be_asked_to_act() {
        // two folds end the hand; the stale turn points at the folded SB
        let state = HandState::new(1, &[5000; 3], OPTIONS);
        let state = state.apply(Action::Fold).unwrap(); // UTG
        let next = state.apply(Action::Fold).unwrap(); // SB, hand over

        assert_eq!(next.street, Street::Complete);
        assert!(matches!(
            next.apply(Action::Check),
            Err(IllegalAction::PlayerCannotAct)
        ));
    }

    #[test]
    fn an_all_in_player_cannot_be_asked_to_act() {
        // everyone all-in preflop runs out; the stale turn points at the
        // all-in BB
        let state = HandState::new(1, &[1100, 1000, 500], OPTIONS);

        let state = state.apply(Action::Raise { to: 1100 }).unwrap(); // UTG, all-in
        let state = state.apply(Action::AllIn).unwrap(); // SB, all-in call
        let next = state.apply(Action::AllIn).unwrap(); // BB, all-in call, runout

        assert_eq!(next.street, Street::Complete);
        assert!(matches!(
            next.apply(Action::Check),
            Err(IllegalAction::PlayerCannotAct)
        ));
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
        assert_eq!(next.stacks(), vec![4800, 4900, 4800]);
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
        assert_eq!(next.stacks(), vec![4800; 3]);
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
    use crate::state::{Action, HandState, IllegalAction, Street};

    use super::super::fixtures::{OPTIONS, check_until};

    #[test]
    fn checking_when_facing_a_bet_is_illegal() {
        let state = HandState::new(1, &[5000; 3], OPTIONS); // UTG faces the BB's 200

        let result = state.apply(Action::Check);

        assert!(matches!(result, Err(IllegalAction::CheckFacingBet)));
    }

    #[test]
    fn a_check_passes_action_to_the_next_player() {
        let state = check_until(&HandState::new(1, &[5000; 3], OPTIONS), Street::Flop);

        let next = state.apply(Action::Check).unwrap(); // SB checks

        assert_eq!(next.to_act, state.positions.bb);
        assert!(!next.players[state.positions.sb].needs_action);
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
        assert_eq!(next.stacks(), vec![4400, 4900, 4800]);
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
    fn a_raise_above_the_stack_is_illegal() {
        let state = HandState::new(1, &[1000, 5000, 5000], OPTIONS);

        let result = state.apply(Action::Raise { to: 10_000 }); // UTG can only shove

        assert!(matches!(
            result,
            Err(IllegalAction::RaiseExceedsStack { max: 1000 })
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
    fn an_all_in_above_the_minimum_is_a_full_raise() {
        let state = HandState::new(1, &[1000, 5000, 5000], OPTIONS);

        let next = state.apply(Action::AllIn).unwrap(); // UTG shoves

        let shover = &next.players[0];
        assert_eq!(shover.bet, 1000); // the chips actually committed
        assert_eq!(shover.stack, 0);
        assert_eq!(next.current_bet, 1000); // all-in for the stack
        assert_eq!(next.min_raise, 1800); // 1000 + the 800 increment

        let next = next.apply(Action::Call).unwrap(); // SB calls 900, not all-in

        assert_eq!(next.players[1].bet, 1000);
        assert_eq!(next.players[1].stack, 4000);
        assert!(next.players[1].can_play()); // calling an all-in leaves the caller in play
    }

    #[test]
    fn a_shove_that_cant_cover_the_bet_is_an_all_in_call() {
        let state = HandState::new(1, &[150, 5000, 5000], OPTIONS);

        let next = state.apply(Action::AllIn).unwrap(); // UTG shoves 150

        let shover = &next.players[0];
        assert_eq!(shover.bet, 150);
        assert_eq!(shover.stack, 0);
        assert!(!shover.can_play());
        assert_eq!(next.current_bet, OPTIONS.blinds.big); // the bet is untouched
        assert_eq!(next.min_raise, OPTIONS.blinds.big * 2);
    }

    #[test]
    fn an_all_in_short_of_a_full_raise_rebases_the_minimum() {
        let state = HandState::new(1, &[300, 5000, 5000], OPTIONS);

        let next = state.apply(Action::AllIn).unwrap(); // UTG shoves 300

        assert_eq!(next.players[0].bet, 300);
        assert_eq!(next.current_bet, 300); // the bet goes up
        assert_eq!(next.min_raise, 500); // 300 + the 200 increment: the next raise must reach 500

        let next = next.apply(Action::Call).unwrap(); // SB
        let next = next.apply(Action::Call).unwrap(); // BB closes the round

        assert_eq!(next.street, Street::Flop);
        assert_eq!(next.pot(), 900);
    }

    #[test]
    fn chained_incomplete_raises_rebase_the_minimum() {
        let state = HandState::new(1, &[300, 400, 5000], OPTIONS);

        let state = state.apply(Action::AllIn).unwrap(); // UTG shoves 300 (incomplete)
        assert_eq!(state.current_bet, 300);
        assert_eq!(state.min_raise, 500); // 300 + the 200 increment

        let next = state.apply(Action::AllIn).unwrap(); // SB shoves 400 (incomplete again)

        assert_eq!(next.current_bet, 400);
        assert_eq!(next.min_raise, 600); // re-based again: 400 + the same 200 increment

        let next = next.apply(Action::Call).unwrap(); // BB closes the round

        assert_eq!(next.street, Street::Flop);
        assert_eq!(next.pot(), 1100);
    }

    #[test]
    fn an_incomplete_raise_offers_a_call_but_not_a_raise() {
        let state = HandState::new(1, &[5000, 5000, 800], OPTIONS);
        let state = state.apply(Action::Raise { to: 600 }).unwrap(); // UTG
        let state = state.apply(Action::Call).unwrap(); // SB
        let next = state.apply(Action::AllIn).unwrap(); // BB shoves 800

        assert_eq!(next.current_bet, 800);
        assert_eq!(next.min_raise, 1200); // re-based: 800 + the 400 increment
        assert!(next.players[0].needs_action); // the callers get a decision
        assert!(!next.players[0].can_raise); // but not raise rights
        assert!(!next.players[1].can_raise); // same for the SB caller

        let result = next.apply(Action::Raise { to: 1000 }); // UTG may not raise

        assert!(matches!(result, Err(IllegalAction::RaiseNotReopened)));

        let next = next.apply(Action::Call).unwrap(); // UTG calls the 200 shortfall
        let next = next.apply(Action::Call).unwrap(); // SB closes the round

        assert_eq!(next.street, Street::Flop);
        assert_eq!(next.pot(), 2400);
        assert_eq!(next.stacks(), vec![4200, 4200, 0]);
    }

    #[test]
    fn an_all_in_above_the_bet_is_illegal_without_reopened_betting() {
        let state = HandState::new(1, &[5000, 5000, 800], OPTIONS);
        let state = state.apply(Action::Raise { to: 600 }).unwrap(); // UTG
        let state = state.apply(Action::Call).unwrap(); // SB
        let state = state.apply(Action::AllIn).unwrap(); // BB shoves 800 (incomplete)

        let result = state.apply(Action::AllIn); // UTG's shove would raise to 5000

        assert!(matches!(result, Err(IllegalAction::RaiseNotReopened)));
    }

    #[test]
    fn an_all_in_call_is_legal_without_raise_rights() {
        // SB calls the 600 raise with 700 behind; after BB's incomplete
        // shove to 800, SB's last 100 can only call and calling needs
        // no raise rights.
        let state = HandState::new(1, &[5000, 700, 800], OPTIONS);
        let state = state.apply(Action::Raise { to: 600 }).unwrap(); // UTG
        let state = state.apply(Action::Call).unwrap(); // SB, 100 behind
        let state = state.apply(Action::AllIn).unwrap(); // BB shoves 800 (incomplete)
        let state = state.apply(Action::Call).unwrap(); // UTG acts again before SB

        assert!(!state.players[1].can_raise); // SB has no raise rights
        assert_eq!(state.current_bet, 800);

        let next = state.apply(Action::AllIn).unwrap(); // SB calls all-in for 100

        let sb = &next.players[1];
        assert_eq!(sb.committed, 700); // blind + call + the all-in call
        assert_eq!(sb.stack, 0);
        assert!(!sb.can_play());

        // SB's all-in call closes the round
        assert_eq!(next.street, Street::Flop);
        assert_eq!(next.pot(), 2300);
    }

    #[test]
    fn a_full_raise_after_an_incomplete_one_reopens_betting() {
        let state = HandState::new(1, &[700, 5000, 5000, 5000], OPTIONS);
        let state = state.apply(Action::Raise { to: 600 }).unwrap(); // UTG (seat 3)
        let state = state.apply(Action::AllIn).unwrap(); // button shoves 700
        let next = state.apply(Action::Raise { to: 1100 }).unwrap(); // SB raises the re-based minimum

        assert_eq!(next.current_bet, 1100);
        assert_eq!(next.min_raise, 1500); // 1100 + the 400 increment
        assert!(next.players[3].can_raise); // the UTG raiser is reopened
        assert!(next.players[3].needs_action);
        assert!(!next.players[0].needs_action); // the all-in shover sits out
    }
}

#[cfg(test)]
mod options_tests {
    use crate::state::{Action, HandState};

    use super::super::fixtures::OPTIONS;

    #[test]
    fn utg_faces_the_big_blind() {
        let state = HandState::new(1, &[5000; 3], OPTIONS);

        let options = state.action_options().unwrap();

        assert!(!options.can_check);
        assert_eq!(options.call_amount, 200);
        assert!(options.can_raise);
        assert_eq!(options.min_raise_to, 400);
        assert_eq!(options.max_raise_to, 5000); // the button posts nothing preflop
    }

    #[test]
    fn the_bb_option_can_check() {
        let state = HandState::new(1, &[5000; 2], OPTIONS);
        let state = state.apply(Action::Call).unwrap(); // SB completes

        let options = state.action_options().unwrap();

        assert!(options.can_check);
        assert_eq!(options.call_amount, 0);
        assert!(options.can_raise);
    }

    #[test]
    fn a_call_is_clamped_to_the_stack() {
        // the button is UTG preflop and posts no blind: 150 faces the 200
        let state = HandState::new(1, &[150, 5000, 5000], OPTIONS);

        let options = state.action_options().unwrap();

        assert!(!options.can_check);
        assert_eq!(options.call_amount, 150); // owed 200, stack 150
        assert_eq!(options.max_raise_to, 150);
    }

    #[test]
    fn an_unreopened_player_cannot_raise() {
        // UTG raises to 600 (min re-bases to 1000), the SB shoves 800 — an
        // incomplete raise above the bet but below the minimum, which grants
        // no raise rights — and the BB folds, leaving the unreopened UTG
        // facing the 800
        let state = HandState::new(1, &[5000, 800, 5000], OPTIONS);
        let state = state.apply(Action::Raise { to: 600 }).unwrap();
        let state = state.apply(Action::AllIn).unwrap(); // SB: 100 blind + 700 stack
        let state = state.apply(Action::Fold).unwrap(); // BB

        let options = state.action_options().unwrap();

        assert!(!options.can_check);
        assert_eq!(options.call_amount, 200);
        assert!(!options.can_raise);
        assert_eq!(options.min_raise_to, 1200); // the shove re-based it
        assert_eq!(options.max_raise_to, 5000);
    }

    #[test]
    fn a_completed_hand_offers_no_options() {
        let state = HandState::new(1, &[5000; 2], OPTIONS);
        let next = state.apply(Action::Fold).unwrap(); // SB folds, BB wins

        assert!(next.action_options().is_none());
    }
}
