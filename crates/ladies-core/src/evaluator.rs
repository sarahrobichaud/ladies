use std::fmt::{self, Display};

use crate::card::{Card, Rank, ranks::RANKS, suits::SUITS};
use crate::hand::Hand;

/// The class of a hand, without tiebreaker detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Category {
    HighCard,
    Pair,
    TwoPair,
    ThreeOfAKind,
    Straight,
    Flush,
    FullHouse,
    FourOfAKind,
    StraightFlush,
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
    /// Five consecutive ranks; the high end (Five for the wheel).
    Straight(Rank),
    /// Five cards of one suit; ranks high to low.
    Flush([Rank; 5]),
    /// The trips, then the pair.
    FullHouse(Rank, Rank),
    /// The quads, then the kicker.
    FourOfAKind(Rank, Rank),
    /// A straight in one suit; the high end (Five for the wheel).
    StraightFlush(Rank),
}

impl HandValue {
    pub const fn category(self) -> Category {
        match self {
            HandValue::HighCard(_) => Category::HighCard,
            HandValue::Pair(..) => Category::Pair,
            HandValue::TwoPair(..) => Category::TwoPair,
            HandValue::ThreeOfAKind(..) => Category::ThreeOfAKind,
            HandValue::Straight(_) => Category::Straight,
            HandValue::Flush(..) => Category::Flush,
            HandValue::FullHouse(..) => Category::FullHouse,
            HandValue::FourOfAKind(..) => Category::FourOfAKind,
            HandValue::StraightFlush(_) => Category::StraightFlush,
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
            HandValue::Straight(high) => write!(f, "Straight, {} high", high.to_char()),
            HandValue::Flush(ranks) => write!(f, "Flush, {} high", ranks[0].to_char()),
            HandValue::FullHouse(trips, pair) => {
                write!(
                    f,
                    "Full House, {}s over {}s",
                    trips.to_char(),
                    pair.to_char()
                )
            }
            HandValue::FourOfAKind(rank, _) => write!(f, "Four of a Kind, {}s", rank.to_char()),
            HandValue::StraightFlush(high) => {
                write!(f, "Straight Flush, {} high", high.to_char())
            }
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

/// Ranks exactly five cards.
fn evaluate_5(cards: &[Card; 5]) -> HandValue {
    let mut counts = [0u8; RANKS.len()];
    let mut suit_counts = [0u8; SUITS.len()];
    for card in cards {
        counts[card.rank.to_index()] += 1;
        suit_counts[card.suit as usize] += 1;
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

    let straight = straight_high(&counts);
    let flush = suit_counts.contains(&5);

    // Five cards partition exactly one way, so these indices are in bounds:
    // quads leaves 1 kicker, trips leaves 2 singles, one pair leaves 3,
    // two pair leaves 1, and a flush is five distinct ranks (one suit cannot
    // repeat a rank).
    if let (true, Some(high)) = (flush, straight) {
        HandValue::StraightFlush(high)
    } else if let Some(&quads) = quads.first() {
        HandValue::FourOfAKind(quads, singles[0])
    } else if let (Some(&trips), Some(&pair)) = (trips.first(), pairs.first()) {
        HandValue::FullHouse(trips, pair)
    } else if let Some(high) = straight {
        HandValue::Straight(high)
    } else if let Some(&trips) = trips.first() {
        HandValue::ThreeOfAKind(trips, [singles[0], singles[1]])
    } else if flush {
        HandValue::Flush([singles[0], singles[1], singles[2], singles[3], singles[4]])
    } else if pairs.len() == 2 {
        HandValue::TwoPair(pairs[0], pairs[1], singles[0])
    } else if pairs.len() == 1 {
        HandValue::Pair(pairs[0], [singles[0], singles[1], singles[2]])
    } else {
        HandValue::HighCard([singles[0], singles[1], singles[2], singles[3], singles[4]])
    }
}

/// High card of the best straight in `counts`, if one exists.
///
/// The wheel (A-2-3-4-5) plays five-high, so the ace doubles as low;
/// no other run wraps around it.
fn straight_high(counts: &[u8; RANKS.len()]) -> Option<Rank> {
    let wheel = [Rank::Two, Rank::Three, Rank::Four, Rank::Five, Rank::Ace];
    if wheel.into_iter().all(|rank| counts[rank.to_index()] > 0) {
        return Some(Rank::Five);
    }

    for high in (4..RANKS.len()).rev() {
        if (high - 4..=high).all(|i| counts[i] > 0) {
            return Some(RANKS[high]);
        }
    }

    None
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
    fn finds_straights_with_the_high_end() {
        assert_eq!(value("9h Td Jc Qs Kd"), HandValue::Straight(Rank::King));
        assert_eq!(value("Ah Kd Qc Js Td"), HandValue::Straight(Rank::Ace));
    }

    #[test]
    fn finds_the_wheel_as_five_high() {
        assert_eq!(value("Ah 2d 3c 4s 5d"), HandValue::Straight(Rank::Five));
    }

    #[test]
    fn does_not_wrap_around_the_ace() {
        // Q-K-A-2-3 is not a straight; it falls back to high card.
        assert_eq!(
            value("Qh Kd Ac 2s 3d"),
            HandValue::HighCard([Rank::Ace, Rank::King, Rank::Queen, Rank::Three, Rank::Two])
        );
    }

    #[test]
    fn straights_compare_by_high_end() {
        assert!(value("9h Td Jc Qs Kd") > value("8h 9d Tc Js Qd"));
        // The wheel is the lowest straight: five-high, below six-high.
        assert!(value("Ah 2d 3c 4s 5d") < value("2h 3d 4c 5s 6h"));
        assert!(value("Th Jd Qc Ks Ad") > value("9h Td Jc Qs Kd"));
    }

    #[test]
    fn straights_beat_trips_and_lose_to_full_houses() {
        assert!(value("9h Td Jc Qs Kd") > value("7h 7d 7s Ad Kc"));
        assert!(value("9h Td Jc Qs Kd") < value("7h 7d 7s Kd Kc"));
    }

    #[test]
    fn seven_card_hands_find_the_best_straight() {
        // Two overlapping straights; the ace-high one wins.
        assert_eq!(
            value("Ah Kd Qc Js Td 9c 2d"),
            HandValue::Straight(Rank::Ace)
        );

        // A straight hiding among paired cards.
        assert_eq!(
            value("5h 5d 6c 7s 8d 9c Th"),
            HandValue::Straight(Rank::Ten)
        );

        // The wheel among seven cards.
        assert_eq!(
            value("Ah 2d 3c 4s 5d Kc Qd"),
            HandValue::Straight(Rank::Five)
        );
    }

    #[test]
    fn paired_or_gapped_runs_are_not_straights() {
        // Duplicate rank breaks the run: 5-5-6-7-8 has no five distinct ranks.
        assert_eq!(
            value("5h 5d 6c 7s 8d"),
            HandValue::Pair(Rank::Five, [Rank::Eight, Rank::Seven, Rank::Six])
        );

        // Gap in the run.
        assert_eq!(
            value("5h 6d 7c 9s Td"),
            HandValue::HighCard([Rank::Ten, Rank::Nine, Rank::Seven, Rank::Six, Rank::Five])
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
        let straight = value("Ah 2d 3c 4s 5d");
        let flush = value("2h 3h 4h 5h 7h");
        let full_house = value("2h 2d 2s Kc Kd");
        let quads = value("2h 2d 2s 2c Kd");
        let straight_flush = value("2h 3h 4h 5h 6h");

        assert!(high_card < pair);
        assert!(pair < two_pair);
        assert!(two_pair < trips);
        assert!(trips < straight);
        assert!(straight < flush);
        assert!(flush < full_house);
        assert!(full_house < quads);
        assert!(quads < straight_flush);
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
    fn finds_flushes_with_ranks_high_to_low() {
        assert_eq!(
            value("Ah Kh Qh Jh 9h"),
            HandValue::Flush([Rank::Ace, Rank::King, Rank::Queen, Rank::Jack, Rank::Nine])
        );
    }

    #[test]
    fn flushes_compare_rank_by_rank() {
        assert!(value("Ah Kh Qh Jh 9h") > value("Ah Kh Qh Jh 8h"));
        // The high card decides before any lower rank does.
        assert!(value("Ah Kh 9h 7h 5h") > value("Kh Qh Jh Th 8h"));
    }

    #[test]
    fn flushes_beat_straights_and_lose_to_full_houses() {
        assert!(value("Ah Kh Qh Jh 9h") > value("9h Td Jc Qs Kd"));
        assert!(value("Ah Kh Qh Jh 9h") < value("7h 7d 7s Kd Kc"));
    }

    #[test]
    fn finds_straight_flushes() {
        assert_eq!(
            value("5h 6h 7h 8h 9h"),
            HandValue::StraightFlush(Rank::Nine)
        );
        assert_eq!(
            value("Ah 2h 3h 4h 5h"),
            HandValue::StraightFlush(Rank::Five)
        );
    }

    #[test]
    fn straight_flushes_beat_quads() {
        assert!(value("5h 6h 7h 8h 9h") > value("9h 9d 9s 9c Ad"));
    }

    #[test]
    fn royal_flush_is_an_ace_high_straight_flush() {
        assert_eq!(value("Th Jh Qh Kh Ah"), HandValue::StraightFlush(Rank::Ace));

        // ...and it outranks every other straight flush.
        assert!(value("Th Jh Qh Kh Ah") > value("9h Th Jh Qh Kh"));
    }

    #[test]
    fn seven_card_hands_find_flushes_and_straight_flushes() {
        // A flush and a straight, but not a straight flush: flush wins.
        assert_eq!(
            value("Ah Kh Qh Jh 9h Td 8d"),
            HandValue::Flush([Rank::Ace, Rank::King, Rank::Queen, Rank::Jack, Rank::Nine])
        );

        assert_eq!(
            value("5h 6h 7h 8h 9h 2c 3c"),
            HandValue::StraightFlush(Rank::Nine)
        );

        // A straight flush outranks the trips sharing these seven cards.
        assert_eq!(
            value("5h 6h 7h 8h 9h 9c 9d"),
            HandValue::StraightFlush(Rank::Nine)
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
        assert_eq!(value("Ah 2d 3c 4s 5d").category(), Category::Straight);
        assert_eq!(value("Ah Kh Qh Jh 9h").category(), Category::Flush);
        assert_eq!(value("2h 2d 2s Kc Kd").category(), Category::FullHouse);
        assert_eq!(value("2h 2d 2s 2c Kd").category(), Category::FourOfAKind);
        assert_eq!(value("5h 6h 7h 8h 9h").category(), Category::StraightFlush);
    }

    #[test]
    fn values_display_readably() {
        assert_eq!(value("Ah Kd Qc Js 9d").to_string(), "High Card A");
        assert_eq!(value("2h 2d Ah Kc Qs").to_string(), "Pair of 2s");
        assert_eq!(value("Ah Ad Kh Ks Qc").to_string(), "Two Pair, As and Ks");
        assert_eq!(value("7h 7d 7s Ad Qc").to_string(), "Three of a Kind, 7s");
        assert_eq!(value("9h Td Jc Qs Kd").to_string(), "Straight, K high");
        assert_eq!(value("Ah 2d 3c 4s 5d").to_string(), "Straight, 5 high");
        assert_eq!(value("Ah Kh Qh Jh 9h").to_string(), "Flush, A high");
        assert_eq!(
            value("5h 6h 7h 8h 9h").to_string(),
            "Straight Flush, 9 high"
        );
        assert_eq!(
            value("7h 7d 7s Kh Kd").to_string(),
            "Full House, 7s over Ks"
        );
        assert_eq!(value("9h 9d 9s 9c Ad").to_string(), "Four of a Kind, 9s");
    }
}
