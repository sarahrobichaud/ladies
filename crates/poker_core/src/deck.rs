use rand::{Rng, seq::SliceRandom};

use crate::{AVAILABLE_SUITS, card::Card};

pub struct Deck {
    cards: [Card; 52],
    next: usize
}

impl Deck {
    pub fn create() -> Self {
        let cards: [Card; 52] = AVAILABLE_SUITS
            .into_iter()
            .flat_map(|suit| (2..=14).map(move | value| Card::create(value, suit)))
            .collect::<Vec<Card>>()
            .try_into()
            .unwrap();

        Self { cards, next: 0 }
    }

    pub fn shuffle(&mut self, rng: &mut impl Rng) {
        self.cards.shuffle(rng);
        self.next = 0;
    }

    pub fn deal(&mut self) -> &Card {
        let card = &self.cards[self.next];
        self.next += 1;
        card
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};
    use rand::{rngs::StdRng, SeedableRng};

    use crate::card::Suit;

use super::*;

    fn get_deck() -> Deck  {
        Deck::create()
    }

    #[test]
    fn creates_a_52_card_deck() {

        let deck = get_deck();

        let mut map: HashMap<Suit, u8> = HashMap::new();

        for card in &deck.cards {
            *map.entry(card.suit()).or_insert(0) += 1;
        }

        for suit in AVAILABLE_SUITS {
            assert_eq!(*map.get(&suit).unwrap_or(&0), 13, "expected 13 cards of suit {:?}", suit);
        }

        assert!(deck.cards.iter().all(|c| (2..=14).contains(&c.value())), "card with out-of-range value");

        let unique: HashSet<(u8, Suit)> = deck.cards.iter().map(|c| c.key()).collect();

        assert_eq!(unique.len(), 52, "deck contains duplicate cards");
    }

    fn seeded_rng(seed: u64) -> StdRng {
        StdRng::seed_from_u64(seed)
    }

    #[test]
    fn shuffle_is_deterministic_for_a_given_seed() {
        let mut a = get_deck();
        let mut b = get_deck();

        a.shuffle(&mut seeded_rng(42));
        b.shuffle(&mut seeded_rng(42));

        let a_order: Vec<_> = a.cards.iter().map(Card::key).collect();
        let b_order: Vec<_> = b.cards.iter().map(Card::key).collect();

        assert_eq!(a_order, b_order);
    }

    #[test]
    fn shuffle_produces_a_permutation_of_the_deck() {
        let mut deck = get_deck();
        let before: HashSet<_> = deck.cards.iter().map(Card::key).collect();

        deck.shuffle(&mut seeded_rng(7));

        let after: HashSet<_> = deck.cards.iter().map(Card::key).collect();

        assert_eq!(before, after);
        assert_eq!(after.len(), 52, "shuffle must not lose or duplicate cards");
    }

    #[test]
    fn shuffle_resets_the_deal_position() {
        let mut deck = get_deck();
        deck.deal();
        deck.deal();

        deck.shuffle(&mut seeded_rng(1));

        let expected = deck.cards[0].key();
        let dealt = deck.deal().key();

        assert_eq!(dealt, expected, "deal after shuffle must start from the top");
    }

    #[test]
    fn different_seeds_produce_different_orders() {
        let mut a = get_deck();
        let mut b = get_deck();

        a.shuffle(&mut seeded_rng(1));
        b.shuffle(&mut seeded_rng(2));

        let a_order: Vec<_> = a.cards.iter().map(Card::key).collect();
        let b_order: Vec<_> = b.cards.iter().map(Card::key).collect();

        assert_ne!(a_order, b_order);
    }

    #[test]
    fn deal_returns_the_correct_card() {

        let mut deck = get_deck();

        let first_suit = AVAILABLE_SUITS[0];

        let card = deck.deal();

        assert_eq!(card.value(), 2);
        assert_eq!(card.suit(), first_suit);

        let card = deck.deal();

        assert_eq!(card.value(), 3);
        assert_eq!(card.suit(), first_suit);

        let card = deck.deal();

        assert_eq!(card.value(), 4);
        assert_eq!(card.suit(), first_suit);

    }
}
