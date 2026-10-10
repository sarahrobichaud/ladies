use ladies_core::{
    Card, Hand,
    evaluator::{best_of, evaluate_all},
};

use crate::state::{HandState, IllegalAction, Seat, next_active_from, pot};

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Street {
    Preflop,
    Flop,
    Turn,
    River,
    Showdown,
    Complete,
}

pub(super) fn advance_turn(
    mutation: &mut HandState,
    seat: Seat,
) -> Result<&HandState, IllegalAction> {
    mutation.to_act = next_active_from(seat, &mutation.players);

    if is_fold_win(mutation) {
        let winnings = pot::total(&mutation.players);
        let winner = mutation
            .players
            .iter()
            .position(|p| p.can_play())
            .expect("fold win implies exactly one active player");
        pot::award(&mut mutation.players, &[winner], winnings);

        for p in &mut mutation.players {
            p.committed = 0;
            p.bet = 0;
        }

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

    mutation.to_act = next_active_from(mutation.positions.button, &mutation.players);
    for p in &mut mutation.players {
        p.needs_action = p.can_play();
    }
}

fn award_showdown(mutation: &mut HandState) {
    let mut candidate_hands: Vec<(Seat, Hand)> = Vec::with_capacity(mutation.players.len());

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

        candidate_hands.push((seat, hand));
    }

    let evaluated = evaluate_all(&candidate_hands);

    let mut awarded = 0;
    for layer in pot::layers(&mutation.players) {
        let eligible: Vec<_> = evaluated
            .iter()
            .filter(|&&(seat, _)| layer.eligible.contains(&seat))
            .copied()
            .collect();
        let (_, winner_seats) = best_of(&eligible).expect("layer has at least one candidate");

        pot::award(&mut mutation.players, &winner_seats, layer.amount);
        awarded += layer.amount;
    }

    debug_assert_eq!(
        awarded,
        pot::total(&mutation.players),
        "every committed chip must be awarded"
    );

    for p in &mut mutation.players {
        p.committed = 0;
        p.bet = 0;
    }
}

#[cfg(test)]
mod flow_tests {
    use std::collections::HashSet;

    use ladies_core::Card;

    use crate::state::{Action, HandState, Pot, Street};

    use super::super::fixtures::{OPTIONS, aces_kings_queens_deck, check_until};

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
    fn the_bb_option_closes_the_preflop_round() {
        let next = check_until(&HandState::new(1, &[5000; 3], OPTIONS), Street::Flop);

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

    #[test]
    fn pots_are_observable_during_the_hand() {
        let state = HandState::from_deck(aces_kings_queens_deck(), &[200, 5000, 5000], OPTIONS);

        let state = state.apply(Action::Call).unwrap(); // UTG, all-in for 200
        let state = state.apply(Action::Raise { to: 500 }).unwrap(); // SB
        let state = state.apply(Action::Call).unwrap(); // BB

        assert_eq!(state.street, Street::Flop); // observable mid-hand, not just at showdown
        assert_eq!(state.pot(), 1200);
        assert_eq!(state.main_pot().map(|p| p.amount), Some(600));
        assert_eq!(
            state.pots(),
            vec![
                Pot {
                    amount: 600,
                    eligible: vec![0, 1, 2] // 200 from each, the main pot
                },
                Pot {
                    amount: 600,
                    eligible: vec![1, 2] // the 300 overcalls, the side pot
                },
            ]
        );
    }
}

#[cfg(test)]
mod showdown_tests {
    use crate::state::{Action, HandState, Street};

    use super::super::fixtures::{
        OPTIONS, aces_kings_aces_deck, aces_kings_queens_deck, check_around, check_until,
        kings_queens_aces_jacks_deck, tied_king_hands_deck,
    };

    #[test]
    fn the_best_hand_wins_at_showdown() {
        let state = HandState::from_deck(aces_kings_queens_deck(), &[5000; 3], OPTIONS);
        let state = check_until(&state, Street::River);

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
        let state = HandState::from_deck(aces_kings_queens_deck(), &[5000; 3], OPTIONS);
        let state = check_until(&state, Street::River);

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
        let state = HandState::from_deck(aces_kings_queens_deck(), &[200, 5000, 5000], OPTIONS);

        let state = state.apply(Action::Call).unwrap();
        assert!(!state.players[0].can_play()); // can't act anymore
        assert!(state.players[0].can_win_pot()); // but still eligible to win

        let state = state.apply(Action::Call).unwrap(); // SB
        let state = state.apply(Action::Check).unwrap(); // BB — flop

        // SB and BB check down the flop, turn, and river; the all-in player sits out
        let state = check_until(&state, Street::Complete);

        assert_eq!(state.street, Street::Complete);
        assert!(state.is_hand_over());
        assert_eq!(state.players[0].stack, 600); // aces win the whole pot — all-in for exactly
        assert_eq!(state.players[1].stack, 4800);
        assert_eq!(state.players[2].stack, 4800);
        assert_eq!(state.pot(), 0);
    }

    #[test]
    fn an_all_in_player_cannot_win_more_than_they_matched_from_each_player() {
        // seat 0 is all-in for 200; the extra 300 from seats 1 and 2 forms
        // a side pot seat 0 cannot touch
        let state = HandState::from_deck(aces_kings_queens_deck(), &[200, 5000, 5000], OPTIONS);

        let state = state.apply(Action::Call).unwrap(); // UTG, all-in for 200
        let state = state.apply(Action::Raise { to: 500 }).unwrap(); // SB
        let state = state.apply(Action::Call).unwrap(); // BB
        assert_eq!(state.pot(), 1200);

        // SB and BB check down the flop, turn, and river
        let next = check_around(&state, Street::Complete);

        assert_eq!(next.street, Street::Complete);
        assert!(next.is_hand_over());
        assert_eq!(next.players[0].stack, 600); // aces take the 600 main pot, 200 from each
        assert_eq!(next.players[1].stack, 5100); // kings take the 600 side pot, 4500 + 600
        assert_eq!(next.players[2].stack, 4500); // queens lose
        assert_eq!(next.pot(), 0);
    }

    #[test]
    fn an_all_in_player_wins_their_match_plus_the_dead_money() {
        // seat 2 is all-in for 150 and seat 1 folds the SB; the all-in wins
        // 150 from each live player plus the dead 100
        let state = HandState::from_deck(
            kings_queens_aces_jacks_deck(),
            &[5000, 5000, 150, 5000],
            OPTIONS,
        );

        let state = state.apply(Action::Call).unwrap(); // UTG
        let state = state.apply(Action::Call).unwrap(); // button
        let state = state.apply(Action::Fold).unwrap(); // SB, dead money
        // the BB is all-in for 150; the round closes
        assert_eq!(state.pot(), 650);

        // UTG and button check down the flop, turn, and river
        let next = check_around(&state, Street::Complete);

        assert_eq!(next.street, Street::Complete);
        assert!(next.is_hand_over());
        assert_eq!(next.players[0].stack, 4900); // kings take the 100 top layer, 4800 + 100
        assert_eq!(next.players[1].stack, 4900); // folded SB
        assert_eq!(next.players[2].stack, 550); // aces: 150 from each live player + dead 100
        assert_eq!(next.players[3].stack, 4800); // jacks lose
        assert_eq!(next.pot(), 0);
    }

    #[test]
    fn pot_splits_when_best_hands_are_equal() {
        let state = HandState::from_deck(aces_kings_aces_deck(), &[5000; 3], OPTIONS);
        let state = check_until(&state, Street::River);
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

    #[test]
    fn an_odd_pot_gives_the_extra_chip_to_the_first_table_position() {
        // a raise to 501 builds a 1503 pot, one odd chip over a two-way split
        let state = HandState::from_deck(tied_king_hands_deck(), &[5000; 3], OPTIONS);

        let state = state.apply(Action::Raise { to: 501 }).unwrap(); // UTG
        let state = state.apply(Action::Call).unwrap(); // SB
        let state = state.apply(Action::Call).unwrap(); // BB
        assert_eq!(state.pot(), 1503);

        // SB, BB, and button check down the flop, turn, and river
        let next = check_around(&state, Street::Complete);

        assert_eq!(next.street, Street::Complete);

        assert!(next.is_hand_over());
        assert_eq!(next.players[0].stack, 5251); // 4499 + 752, the odd chip goes to seat 0
        assert_eq!(next.players[1].stack, 5250); // 4499 + 751
        assert_eq!(next.players[2].stack, 4499); // ace-queen kickers lose
        assert_eq!(next.pot(), 0);
    }
}
