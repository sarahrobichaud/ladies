use std::fmt::{self, Display};

use crate::card::{Card, Rank, ranks::RANKS};
use crate::hand::Hand;

/// The class of a hand, without tiebreaker detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Category {
    HighCard,
    Pair,
    TwoPair,
    ThreeOfAKind,
    FullHouse,
    FourOfAKind,
}

/// The strength of the best five-card hand found in a hand of cards.
///
/// Variants are declared in strength order and fields in significance
/// order, so the derived [`Ord`] compares hands correctly, kickers included.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum HandValue {
    HighCard([Rank; 5]),
    /// The pair, then kickers high to low.
    Pair(Rank, [Rank; 3]),
    /// High pair, low pair, kicker.
    TwoPair(Rank, Rank, Rank),
    /// The trips, then kickers high to low.
    ThreeOfAKind(Rank, [Rank; 2]),
    /// The trips, then the pair.
    FullHouse(Rank, Rank),
    /// The quads, then the kicker.
    FourOfAKind(Rank, Rank),
}

impl HandValue {
    pub const fn category(self) -> Category {
        match self {
            HandValue::HighCard(_) => Category::HighCard,
            HandValue::Pair(..) => Category::Pair,
            HandValue::TwoPair(..) => Category::TwoPair,
            HandValue::ThreeOfAKind(..) => Category::ThreeOfAKind,
            HandValue::FullHouse(..) => Category::FullHouse,
            HandValue::FourOfAKind(..) => Category::FourOfAKind,
        }
    }
}

impl Display for HandValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HandValue::HighCard(ranks) => write!(f, "High Card {}", ranks[0].to_char()),
            HandValue::Pair(rank, _) => write!(f, "Pair of {}s", rank.to_char()),
            HandValue::TwoPair(high, low, _) => {
                write!(f, "Two Pair, {}s and {}s", high.to_char(), low.to_char())
            }
            HandValue::ThreeOfAKind(rank, _) => write!(f, "Three of a Kind, {}s", rank.to_char()),
            HandValue::FullHouse(trips, pair) => {
                write!(
                    f,
                    "Full House, {}s over {}s",
                    trips.to_char(),
                    pair.to_char()
                )
            }
            HandValue::FourOfAKind(rank, _) => write!(f, "Four of a Kind, {}s", rank.to_char()),
        }
    }
}

/// Ranks a hand by evaluating every five-card combination it contains and
/// keeping the strongest.
pub fn evaluate(hand: &Hand) -> HandValue {
    let cards = hand.cards();
    match cards.len() {
        5 => {
            let cards: [Card; 5] = cards.try_into().unwrap();
            evaluate_5(&cards)
        }
        _ => best_of_combinations(cards),
    }
}

/// The strongest value over all five-card subsets of `cards`.
fn best_of_combinations(cards: &[Card]) -> HandValue {
    let n = cards.len();
    let mut best: Option<HandValue> = None;

    for i0 in 0..n - 4 {
        for i1 in i0 + 1..n - 3 {
            for i2 in i1 + 1..n - 2 {
                for i3 in i2 + 1..n - 1 {
                    for i4 in i3 + 1..n {
                        let combo = [cards[i0], cards[i1], cards[i2], cards[i3], cards[i4]];
                        let value = evaluate_5(&combo);
                        if best.is_none_or(|current| value > current) {
                            best = Some(value);
                        }
                    }
                }
            }
        }
    }

    best.expect("Hand should guarantee five cards, so at least one combination")
}

/// Ranks exactly five cards. Suits are ignored: with no flush category,
/// they cannot affect strength.
fn evaluate_5(cards: &[Card; 5]) -> HandValue {
    let mut counts = [0u8; RANKS.len()];
    for card in cards {
        counts[card.rank.to_index()] += 1;
    }

    // Groups sorted by count desc, then rank desc, so pairs/trips/singles
    // come out already ordered by significance.
    let mut groups: Vec<(u8, Rank)> = RANKS
        .into_iter()
        .filter_map(|rank| {
            let count = counts[rank.to_index()];
            (count > 0).then_some((count, rank))
        })
        .collect();
    groups.sort_unstable_by_key(|&(count, rank)| {
        use std::cmp::Reverse;
        (Reverse(count), Reverse(rank))
    });

    let quads: Vec<Rank> = groups
        .iter()
        .filter(|&&(count, _)| count == 4)
        .map(|&(_, rank)| rank)
        .collect();
    let trips: Vec<Rank> = groups
        .iter()
        .filter(|&&(count, _)| count == 3)
        .map(|&(_, rank)| rank)
        .collect();
    let pairs: Vec<Rank> = groups
        .iter()
        .filter(|&&(count, _)| count == 2)
        .map(|&(_, rank)| rank)
        .collect();
    let singles: Vec<Rank> = groups
        .iter()
        .filter(|&&(count, _)| count == 1)
        .map(|&(_, rank)| rank)
        .collect();

    // Five cards partition exactly one way, so these indices are in bounds:
    // quads leaves 1 kicker, trips leaves 2 singles, one pair leaves 3,
    // two pair leaves 1.
    if let Some(&quads) = quads.first() {
        HandValue::FourOfAKind(quads, singles[0])
    } else if let (Some(&trips), Some(&pair)) = (trips.first(), pairs.first()) {
        HandValue::FullHouse(trips, pair)
    } else if let Some(&trips) = trips.first() {
        HandValue::ThreeOfAKind(trips, [singles[0], singles[1]])
    } else if pairs.len() == 2 {
        HandValue::TwoPair(pairs[0], pairs[1], singles[0])
    } else if pairs.len() == 1 {
        HandValue::Pair(pairs[0], [singles[0], singles[1], singles[2]])
    } else {
        HandValue::HighCard([singles[0], singles[1], singles[2], singles[3], singles[4]])
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use crate::hand::Hand;

    use super::*;

    fn value(s: &str) -> HandValue {
        evaluate(&Hand::from_str(s).unwrap())
    }

    #[test]
    fn ranks_cards_high_to_low_for_high_card() {
        assert_eq!(
            value("Ah Kd Qc Js 9d"),
            HandValue::HighCard([Rank::Ace, Rank::King, Rank::Queen, Rank::Jack, Rank::Nine])
        );
    }

    #[test]
    fn finds_pairs_with_sorted_kickers() {
        assert_eq!(
            value("2h 2d Ah Kc Qs"),
            HandValue::Pair(Rank::Two, [Rank::Ace, Rank::King, Rank::Queen])
        );
    }

    #[test]
    fn finds_two_pairs_high_low_kicker() {
        assert_eq!(
            value("Ah Ad Kh Ks Qc"),
            HandValue::TwoPair(Rank::Ace, Rank::King, Rank::Queen)
        );
    }

    #[test]
    fn finds_trips_with_sorted_kickers() {
        assert_eq!(
            value("7h 7d 7s Ad Qc"),
            HandValue::ThreeOfAKind(Rank::Seven, [Rank::Ace, Rank::Queen])
        );
    }

    #[test]
    fn finds_full_houses() {
        assert_eq!(
            value("7h 7d 7s Kh Kd"),
            HandValue::FullHouse(Rank::Seven, Rank::King)
        );
        assert_eq!(
            value("Kh Kd 7h 7d 7s"),
            HandValue::FullHouse(Rank::Seven, Rank::King)
        );
    }

    #[test]
    fn finds_four_of_a_kind_with_kicker() {
        assert_eq!(
            value("9h 9d 9s 9c Ad"),
            HandValue::FourOfAKind(Rank::Nine, Rank::Ace)
        );
    }

    #[test]
    fn higher_categories_beat_lower_ones() {
        let high_card = value("Ah Kd Qc Js 9d");
        let pair = value("2h 2d Ah Kc Qs");
        let two_pair = value("2h 2d 3h 3d Ac");
        let trips = value("2h 2d 2s Ac Kd");
        let full_house = value("2h 2d 2s Kc Kd");
        let quads = value("2h 2d 2s 2c Kd");

        assert!(high_card < pair);
        assert!(pair < two_pair);
        assert!(two_pair < trips);
        assert!(trips < full_house);
        assert!(full_house < quads);
    }

    #[test]
    fn pairs_compare_by_pair_then_kickers() {
        assert!(value("Ah Ad Kc Qs Jd") > value("Kh Kd Ac Qs Jd"));
        assert!(value("2h 2d Ah Kc Qs") > value("2s 2c Ah Kd Js"));
    }

    #[test]
    fn two_pairs_compare_top_pair_first_then_low_pair_then_kicker() {
        assert!(value("Ah Ad Kh Ks Qc") > value("Ah Ad Qs Qc Kd"));
        assert!(value("Ah Ad Kh Ks Qc") > value("Ah Ad Kh Ks Jc"));
        assert!(value("Ah Ad Kh Ks Qc") > value("Ks Kc Qh Qs Ad"));
    }

    #[test]
    fn trips_compare_by_trips_then_kickers() {
        assert!(value("Ah Ad As Kd Qc") > value("Kh Kd Ks Ac Qd"));
        assert!(value("7h 7d 7s Ac Kd") > value("7c 7s 7h Ac Qd"));
    }

    #[test]
    fn full_houses_compare_by_trips_then_pair() {
        assert!(value("Ah Ad As Kh Kd") > value("Kh Kd Ks Ac Qd"));
        assert!(value("Ah Ad As Kh Kd") > value("Ah Ad As Qs Qd"));
    }

    #[test]
    fn quads_compare_by_quads_then_kicker() {
        assert!(value("9h 9d 9s 9c Ad") > value("8h 8d 8s 8c Ad"));
        assert!(value("9h 9d 9s 9c Ad") > value("9h 9d 9s 9c Kd"));
    }

    #[test]
    fn suits_do_not_affect_strength_yet() {
        // A flush-shaped hand is judged as high card until flushes exist.
        assert_eq!(
            value("Ah Kh Qh Jh 9h"),
            HandValue::HighCard([Rank::Ace, Rank::King, Rank::Queen, Rank::Jack, Rank::Nine])
        );
    }

    #[test]
    fn seven_card_hands_find_the_best_five() {
        // Pair buried among seven cards.
        assert_eq!(
            value("2h 2d Ah Kc Qs Jd 9c"),
            HandValue::Pair(Rank::Two, [Rank::Ace, Rank::King, Rank::Queen])
        );

        // Trips with four distinct kickers stays trips.
        assert_eq!(
            value("7h 7d 7s Ad Qc Kc 2d"),
            HandValue::ThreeOfAKind(Rank::Seven, [Rank::Ace, Rank::King])
        );

        // Trips plus any pair upgrades to a full house.
        assert_eq!(
            value("7h 7d 7s Ad Qc 2c 2d"),
            HandValue::FullHouse(Rank::Seven, Rank::Two)
        );

        // Two pairs in seven cards: the better pair combination wins.
        assert_eq!(
            value("Ah Ad Kh Ks Qc 2c 2d"),
            HandValue::TwoPair(Rank::Ace, Rank::King, Rank::Queen)
        );
    }

    #[test]
    fn seven_card_hands_find_full_houses_and_quads() {
        assert_eq!(
            value("7h 7d 7s Kh Kd 2c 3c"),
            HandValue::FullHouse(Rank::Seven, Rank::King)
        );

        assert_eq!(
            value("9h 9d 9s 9c Ad 2c 3c"),
            HandValue::FourOfAKind(Rank::Nine, Rank::Ace)
        );
    }

    #[test]
    fn seven_card_hands_still_compare_correctly() {
        assert!(value("Ah Ad As Kh Kd 2c 3c") > value("Kh Kd Ks Ac Qd 2c 3c"));
        assert!(value("9h 9d 9s 9c Ad 2c 3c") > value("8h 8d 8s 8c Ad 2c 3c"));
    }

    #[test]
    fn category_matches_the_value() {
        assert_eq!(value("Ah Kd Qc Js 9d").category(), Category::HighCard);
        assert_eq!(value("2h 2d Ah Kc Qs").category(), Category::Pair);
        assert_eq!(value("2h 2d 3h 3d Ac").category(), Category::TwoPair);
        assert_eq!(value("2h 2d 2s Ac Kd").category(), Category::ThreeOfAKind);
        assert_eq!(value("2h 2d 2s Kc Kd").category(), Category::FullHouse);
        assert_eq!(value("2h 2d 2s 2c Kd").category(), Category::FourOfAKind);
    }

    #[test]
    fn values_display_readably() {
        assert_eq!(value("Ah Kd Qc Js 9d").to_string(), "High Card A");
        assert_eq!(value("2h 2d Ah Kc Qs").to_string(), "Pair of 2s");
        assert_eq!(value("Ah Ad Kh Ks Qc").to_string(), "Two Pair, As and Ks");
        assert_eq!(value("7h 7d 7s Ad Qc").to_string(), "Three of a Kind, 7s");
        assert_eq!(
            value("7h 7d 7s Kh Kd").to_string(),
            "Full House, 7s over Ks"
        );
        assert_eq!(value("9h 9d 9s 9c Ad").to_string(), "Four of a Kind, 9s");
    }
}
