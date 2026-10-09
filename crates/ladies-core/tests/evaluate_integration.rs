use std::str::FromStr;

use ladies_core::{Category, Hand, HandValue, Rank, StandardDeck, evaluate};
use rand::{SeedableRng, rngs::StdRng};

/// Parses a hand from notation, for readable test tables.
fn hand(notation: &str) -> Hand {
    Hand::from_str(notation).unwrap()
}

const GOLDEN_FIVE: &[(&str, HandValue)] = &[
    (
        "Ah Kd 9c 6s 3d",
        HandValue::HighCard([Rank::Ace, Rank::King, Rank::Nine, Rank::Six, Rank::Three]),
    ),
    (
        "Ah As Kd 9c 3d",
        HandValue::Pair(Rank::Ace, [Rank::King, Rank::Nine, Rank::Three]),
    ),
    (
        "Ah As Kd Kc 3d",
        HandValue::TwoPair(Rank::Ace, Rank::King, Rank::Three),
    ),
    (
        "Ah As Ad Kd 3d",
        HandValue::ThreeOfAKind(Rank::Ace, [Rank::King, Rank::Three]),
    ),
    ("9h 8d 7c 6s 5d", HandValue::Straight(Rank::Nine)),
    ("Ah 2d 3c 4s 5d", HandValue::Straight(Rank::Five)),
    (
        "Ah Qh 9h 5h 2h",
        HandValue::Flush([Rank::Ace, Rank::Queen, Rank::Nine, Rank::Five, Rank::Two]),
    ),
    (
        "Ah As Ad Kd Kc",
        HandValue::FullHouse(Rank::Ace, Rank::King),
    ),
    (
        "Ah As Ad Ac Kd",
        HandValue::FourOfAKind(Rank::Ace, Rank::King),
    ),
    ("9h 8h 7h 6h 5h", HandValue::StraightFlush(Rank::Nine)),
    ("Ah Kh Qh Jh Th", HandValue::StraightFlush(Rank::Ace)),
];

const GOLDEN_SEVEN: &[(&str, HandValue)] = &[
    // The nine of hearts is dead weight; the royal flush still wins.
    ("Ah Kh Qh Jh Th 9h 2c", HandValue::StraightFlush(Rank::Ace)),
    // Two pair plus a bare pair must not be mistaken for a full house.
    (
        "Ah Ad Kh Ks 2c 2d 3h",
        HandValue::TwoPair(Rank::Ace, Rank::King, Rank::Three),
    ),
    // Trips aces pair with the kings, not the queens.
    (
        "Ah Ad Ac Kh Ks Qd Qc",
        HandValue::FullHouse(Rank::Ace, Rank::King),
    ),
    (
        "2h 2d 2c 2s Ah Kd Qc",
        HandValue::FourOfAKind(Rank::Two, Rank::Ace),
    ),
    ("As Ks Qs Js Ts 9s 2c", HandValue::StraightFlush(Rank::Ace)),
    // Seven clubs hold both a nine-high and an eight-high straight flush.
    ("9c 8c 7c 6c 5c 4c 3c", HandValue::StraightFlush(Rank::Nine)),
    // The seven-high run beats both the wheel and the six-high straight.
    ("Ah 2d 3c 4s 5d 6c 7h", HandValue::Straight(Rank::Seven)),
];

#[test]
fn parses_and_evaluates_five_card_hands_in_every_category() {
    for (notation, expected) in GOLDEN_FIVE {
        assert_eq!(evaluate(&hand(notation)), *expected, "hand: {notation}");
    }
}

#[test]
fn parses_and_evaluates_seven_card_hands_through_the_public_api() {
    for (notation, expected) in GOLDEN_SEVEN {
        assert_eq!(evaluate(&hand(notation)), *expected, "hand: {notation}");
    }
}

#[test]
fn stronger_categories_parsed_from_notation_beat_weaker_ones() {
    let ordered: &[(&str, Category)] = &[
        ("Ah Kd 9c 6s 3d", Category::HighCard),
        ("Ah As Kd 9c 3d", Category::Pair),
        ("Ah As Kd Kc 3d", Category::TwoPair),
        ("Ah As Ad Kd 3d", Category::ThreeOfAKind),
        ("9h 8d 7c 6s 5d", Category::Straight),
        ("Ah Qh 9h 5h 2h", Category::Flush),
        ("Ah As Ad Kd Kc", Category::FullHouse),
        ("Ah As Ad Ac Kd", Category::FourOfAKind),
        ("9h 8h 7h 6h 5h", Category::StraightFlush),
    ];

    for pair in ordered.windows(2) {
        let weak = evaluate(&hand(pair[0].0));
        let strong = evaluate(&hand(pair[1].0));

        assert!(
            weak < strong,
            "{} ({weak}) must lose to {} ({strong})",
            pair[0].0,
            pair[1].0
        );
    }

    for (notation, category) in ordered {
        assert_eq!(
            evaluate(&hand(notation)).category(),
            *category,
            "hand: {notation}"
        );
    }
}

/// The deck-to-hand seam: `deal_n` must never repeat a card, which is the
/// invariant `Hand::new` enforces.
#[test]
fn dealt_cards_are_always_distinct() {
    for seed in 0..64u64 {
        let mut deck = StandardDeck::new();
        deck.shuffle(&mut StdRng::seed_from_u64(seed));

        let cards = deck.deal_n::<7>().expect("a fresh deck has seven cards");
        Hand::new(cards.to_vec()).expect("dealt cards must be distinct");
    }
}

#[test]
fn hole_cards_and_board_dealt_from_one_deck_never_overlap() {
    for seed in 0..16u64 {
        let mut deck = StandardDeck::new();
        deck.shuffle(&mut StdRng::seed_from_u64(seed));

        let hole = deck.deal_n::<2>().expect("a fresh deck has two cards");
        let board = deck.deal_n::<5>().expect("a fresh deck has seven cards");

        for card in board {
            assert!(!hole.contains(&card), "seed: {seed}, {card} dealt twice");
        }

        Hand::new([hole.as_slice(), board.as_slice()].concat()).unwrap();
    }
}
