use super::Player;
use crate::state::{Chips, Seat};

/// One layer of the pot, ordered from the main pot upward: the first layer
/// is the main pot, the rest are side pots. Every player chips into each
/// layer up to their own commitment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pot {
    pub amount: Chips,
    pub eligible: Vec<Seat>,
}

pub(crate) fn total(players: &[Player]) -> Chips {
    players.iter().map(|p| p.committed).sum()
}

/// Splits the committed chips into layers at each distinct all-in
/// contribution.
pub(crate) fn layers(players: &[Player]) -> Vec<Pot> {
    let mut levels: Vec<Chips> = players
        .iter()
        .filter(|p| p.can_win_pot())
        .map(|p| p.committed)
        .collect();
    levels.sort_unstable();
    levels.dedup();

    let mut pots = Vec::with_capacity(levels.len());
    let mut matched = 0;
    for level in levels {
        let amount: Chips = players
            .iter()
            .map(|p| p.committed.min(level) - p.committed.min(matched))
            .sum();
        matched = level;

        // The only empty layer is the one at zero, from players yet to act.
        if amount == 0 {
            continue;
        }

        let eligible = players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.can_win_pot() && p.committed >= level)
            .map(|(seat, _)| seat)
            .collect();
        pots.push(Pot { amount, eligible });
    }
    pots
}

/// Awards `amount` to `seats`, split evenly with any odd chips going one
/// apiece to the earliest table positions.
pub(crate) fn award(players: &mut [Player], seats: &[Seat], amount: Chips) {
    assert!(!seats.is_empty(), "a pot must be awarded to someone");

    let share = amount / seats.len() as u64;
    let odd_chips = (amount % seats.len() as u64) as usize;

    for (index, &seat) in seats.iter().enumerate() {
        players[seat].stack += share + u64::from(index < odd_chips);
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use ladies_core::Card;

    use super::{Pot, award, layers, total};
    use crate::state::{Chips, Player, player::Status};

    fn player(committed: Chips, status: Status) -> Player {
        Player {
            stack: 5000,
            bet: 0,
            committed,
            hole: [Card::from_str("As").unwrap(), Card::from_str("Ks").unwrap()],
            status,
            needs_action: false,
        }
    }

    fn players(contributions: &[(Chips, Status)]) -> Vec<Player> {
        contributions
            .iter()
            .map(|&(committed, status)| player(committed, status))
            .collect()
    }

    #[test]
    fn the_pot_totals_every_committed_chip() {
        let players = players(&[
            (200, Status::Active),
            (500, Status::Active),
            (500, Status::AllIn),
        ]);

        assert_eq!(total(&players), 1200);
    }

    #[test]
    fn equal_contributions_make_a_single_pot() {
        let players = players(&[(200, Status::Active); 3]);

        assert_eq!(
            layers(&players),
            vec![Pot {
                amount: 600,
                eligible: vec![0, 1, 2]
            }]
        );
    }

    #[test]
    fn an_all_in_splits_the_pot_into_a_main_and_side_pot() {
        let players = players(&[
            (200, Status::AllIn),
            (500, Status::Active),
            (500, Status::Active),
        ]);

        assert_eq!(
            layers(&players),
            vec![
                Pot {
                    amount: 600,
                    eligible: vec![0, 1, 2] // 200 from each
                },
                Pot {
                    amount: 600,
                    eligible: vec![1, 2] // the 300 overcalls
                },
            ]
        );
    }

    #[test]
    fn folded_players_dead_money_stays_winnable_but_they_are_not_eligible() {
        let players = players(&[
            (200, Status::Active),
            (100, Status::Folded),
            (150, Status::AllIn),
            (200, Status::Active),
        ]);

        assert_eq!(
            layers(&players),
            vec![
                Pot {
                    amount: 550,
                    eligible: vec![0, 2, 3] // 150 × 3 + the dead 100
                },
                Pot {
                    amount: 100,
                    eligible: vec![0, 3] // above the all-in's match
                },
            ]
        );
    }

    #[test]
    fn players_who_havent_matched_the_bet_arent_eligible_for_its_layer() {
        let players = players(&[
            (0, Status::Active),
            (100, Status::Active),
            (200, Status::Active),
        ]);

        assert_eq!(
            layers(&players),
            vec![
                Pot {
                    amount: 200,
                    eligible: vec![1, 2] // the blinds
                },
                Pot {
                    amount: 100,
                    eligible: vec![2] // only the BB has matched 200
                },
            ]
        );
    }

    #[test]
    fn an_uncalled_bet_is_returned_as_its_own_layer() {
        let players = players(&[(200, Status::AllIn), (500, Status::Active)]);

        assert_eq!(
            layers(&players),
            vec![
                Pot {
                    amount: 400,
                    eligible: vec![0, 1]
                },
                Pot {
                    amount: 300,
                    eligible: vec![1] // the uncalled raise comes back
                },
            ]
        );
    }

    #[test]
    fn the_main_pot_is_the_first_layer_even_when_a_side_pot_is_larger() {
        let players = players(&[
            (100, Status::AllIn),
            (1000, Status::Active),
            (1000, Status::Active),
        ]);

        let pots = layers(&players);

        assert_eq!(pots[0].amount, 300); // the main pot, everyone is eligible
        assert_eq!(pots[0].eligible, vec![0, 1, 2]);
        assert!(pots[1].amount > pots[0].amount); // the side pot dwarfs it
    }

    #[test]
    fn awarded_chips_split_evenly_with_odd_chips_to_the_earliest_positions() {
        let mut players = players(&[(0, Status::Active); 3]);

        award(&mut players, &[0, 1, 2], 1001);

        assert_eq!(players[0].stack, 5334); // two odd chips to the first positions
        assert_eq!(players[1].stack, 5334);
        assert_eq!(players[2].stack, 5333);
    }

    #[test]
    fn a_single_winner_takes_the_whole_award() {
        let mut players = players(&[(0, Status::Active), (0, Status::Folded)]);

        award(&mut players, &[0], 650);

        assert_eq!(players[0].stack, 5650);
        assert_eq!(players[1].stack, 5000);
    }
}
