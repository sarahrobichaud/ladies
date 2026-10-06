use std::fmt::{self, Display};

use crate::card::{Rank, ranks::RANKS};
use crate::hand::Hand;

/// The class of a hand, without tiebreaker detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Category {
    HighCard,
    Pair,
    TwoPair,
    ThreeOfAKind,
}

/// The strength of a five-card hand.
///
/// Variants are declared in strength order and fields in significance
/// order, so the derived Ord works
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum HandValue {
    HighCard([Rank; 5]),
    /// The pair, then kickers high to low.
    Pair(Rank, [Rank; 3]),
    /// High pair, low pair, kicker.
    TwoPair(Rank, Rank, Rank),
    /// The trips, then kickers high to low.
    ThreeOfAKind(Rank, [Rank; 2]),
}

impl HandValue {
    pub const fn category(self) -> Category {
        match self {
            HandValue::HighCard(_) => Category::HighCard,
            HandValue::Pair(..) => Category::Pair,
            HandValue::TwoPair(..) => Category::TwoPair,
            HandValue::ThreeOfAKind(..) => Category::ThreeOfAKind,
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
        }
    }
}

/// Ranks a five-card hand. No suits yet
pub fn evaluate(hand: &Hand) -> HandValue {
    let mut counts = [0u8; RANKS.len()];
    for card in hand.cards() {
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

    groups.sort_unstable_by_key(|(count, rank)| {
        use std::cmp::Reverse;
        (Reverse(*count), Reverse(*rank))
    });

    let trips = groups.iter().find(|&&(count,_)| count == 3).map(|&(_, rank)| rank);

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

    if let Some(trips) = trips {
        HandValue::ThreeOfAKind(trips, [singles[0], singles[1]])
    } else if pairs.len() == 2 {
        HandValue::TwoPair(pairs[0], pairs[1], singles[0])
    } else if pairs.len() == 1 {
        HandValue::Pair(pairs[0], [singles[0], singles[1], singles[2]])
    } else {
        HandValue::HighCard([
            singles[0], singles[1], singles[2], singles[3], singles[4],
        ])
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
            value("AhKdQcJs9d"),
            HandValue::HighCard([Rank::Ace, Rank::King, Rank::Queen, Rank::Jack, Rank::Nine])
        );
    }

    #[test]
    fn finds_pairs_with_sorted_kickers() {
        assert_eq!(
            value("2h2dAhKcQs"),
            HandValue::Pair(Rank::Two, [Rank::Ace, Rank::King, Rank::Queen])
        );
    }

    #[test]
    fn finds_two_pairs_high_low_kicker() {
        assert_eq!(
            value("AhAdKhKsQc"),
            HandValue::TwoPair(Rank::Ace, Rank::King, Rank::Queen)
        );
    }

    #[test]
    fn finds_trips_with_sorted_kickers() {
        assert_eq!(
            value("7h7d7sAdQc"),
            HandValue::ThreeOfAKind(Rank::Seven, [Rank::Ace, Rank::Queen])
        );
        assert_eq!(
            value("7h7d7sQcAd"),
            HandValue::ThreeOfAKind(Rank::Seven, [Rank::Ace, Rank::Queen])
        );
    }

    #[test]
    fn higher_categories_beat_lower_ones() {
        let high_card = value("AhKdQcJs9d");
        let pair = value("2h2dAhKcQs");
        let two_pair = value("2h2d3h3dAc");
        let trips = value("2h2d2sAcKd");

        assert!(high_card < pair);
        assert!(pair < two_pair);
        assert!(two_pair < trips);
    }

    #[test]
    fn pairs_compare_by_pair_then_kickers() {
        assert!(value("AhAdKcQsJd") > value("KhKdAcQsJd"));
        assert!(value("2h2dAhKcQs") > value("2s2cAhKdJs"));
    }

    #[test]
    fn two_pairs_compare_top_pair_first_then_low_pair_then_kicker() {
        assert!(value("AhAdKhKsQc") > value("AhAdQsQcKd"));
        assert!(value("AhAdKhKsQc") > value("AhAdKhKsJc"));
        assert!(value("AhAdKhKsQc") > value("KsKcQhQsAd"));
    }

    #[test]
    fn trips_compare_by_trips_then_kickers() {
        assert!(value("AhAdAsKdQc") > value("KhKdKsAcQd"));
        assert!(value("7h7d7sAcKd") > value("7c7s7hAcQd"));
    }

    #[test]
    fn suits_do_not_affect_strength_yet() {
        assert_eq!(
            value("AhKhQhJh9h"),
            HandValue::HighCard([Rank::Ace, Rank::King, Rank::Queen, Rank::Jack, Rank::Nine])
        );
    }

    #[test]
    fn category_matches_the_value() {
        assert_eq!(value("AhKdQcJs9d").category(), Category::HighCard);
        assert_eq!(value("2h2dAhKcQs").category(), Category::Pair);
        assert_eq!(value("2h2d3h3dAc").category(), Category::TwoPair);
        assert_eq!(value("2h2d2sAcKd").category(), Category::ThreeOfAKind);
    }

    #[test]
    fn values_display_readably() {
        assert_eq!(value("AhKdQcJs9d").to_string(), "High Card A");
        assert_eq!(value("2h2dAhKcQs").to_string(), "Pair of 2s");
        assert_eq!(value("AhAdKhKsQc").to_string(), "Two Pair, As and Ks");
        assert_eq!(value("7h7d7sAdQc").to_string(), "Three of a Kind, 7s");
    }
}
