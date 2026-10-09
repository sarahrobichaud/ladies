use rand::{Rng, seq::SliceRandom};

use crate::card::{Card, ranks::RANKS, suits::SUITS};

pub struct StandardDeck {
    cards: [Card; 52],
    cursor: usize,
}

impl StandardDeck {
    pub fn new() -> Self {
        let cards: [Card; 52] = SUITS
            .into_iter()
            .flat_map(|suit| RANKS.into_iter().map(move |rank| Card { rank, suit }))
            .collect::<Vec<Card>>()
            .try_into()
            .unwrap();

        Self { cards, cursor: 0 }
    }

    pub fn shuffle(&mut self, rng: &mut impl Rng) {
        self.cards.shuffle(rng);
        self.cursor = 0;
    }

    pub fn deal(&mut self) -> Option<Card> {
        let card = self.cards.get(self.cursor).copied()?;
        self.cursor += 1;
        Some(card)
    }

    /// Deals the next `N` cards, or `None` if fewer than `N` remain.
    pub fn deal_n<const N: usize>(&mut self) -> Option<[Card; N]> {
        if self.remaining() < N {
            return None;
        }

        let cards: [Card; N] = self.cards[self.cursor..self.cursor + N]
            .try_into()
            .expect("slice length checked above");
        self.cursor += N;
        Some(cards)
    }

    pub fn remaining(&self) -> usize {
        self.cards.len() - self.cursor
    }
}

impl Default for StandardDeck {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use rand::{SeedableRng, rngs::StdRng};
    use std::collections::{HashMap, HashSet};

    use crate::card::{Rank, Suit};

    use super::*;

    fn get_fresh_standard_deck() -> StandardDeck {
        StandardDeck::new()
    }

    fn card(rank: Rank, suit: Suit) -> Card {
        Card { rank, suit }
    }

    #[test]
    fn creates_a_52_card_deck() {
        let deck = get_fresh_standard_deck();

        let mut map: HashMap<Suit, u8> = HashMap::new();

        for card in &deck.cards {
            *map.entry(card.suit).or_insert(0) += 1;
        }

        for suit in SUITS {
            assert_eq!(
                *map.get(&suit).unwrap_or(&0),
                13,
                "expected 13 cards of suit {:?}",
                suit
            );
        }

        let unique: HashSet<Card> = deck.cards.into_iter().collect();

        assert_eq!(unique.len(), 52, "deck contains duplicate cards");
    }

    fn seeded_rng(seed: u64) -> StdRng {
        StdRng::seed_from_u64(seed)
    }

    #[test]
    fn shuffle_is_deterministic_for_a_given_seed() {
        let mut a = get_fresh_standard_deck();
        let mut b = get_fresh_standard_deck();

        a.shuffle(&mut seeded_rng(42));
        b.shuffle(&mut seeded_rng(42));

        let a_order: Vec<_> = a.cards.iter().collect();
        let b_order: Vec<_> = b.cards.iter().collect();

        assert_eq!(a_order, b_order);
    }

    #[test]
    fn shuffle_produces_a_permutation_of_the_deck() {
        let mut deck = get_fresh_standard_deck();
        let before: HashSet<_> = deck.cards.into_iter().collect();

        deck.shuffle(&mut seeded_rng(7));

        let after: HashSet<_> = deck.cards.into_iter().collect();

        assert_eq!(before, after);
        assert_eq!(after.len(), 52, "shuffle must not lose or duplicate cards");
    }

    #[test]
    fn shuffle_resets_the_deal_position() {
        let mut deck = get_fresh_standard_deck();
        deck.deal();
        deck.deal();

        deck.shuffle(&mut seeded_rng(1));

        let expected = deck.cards[0];
        let dealt = deck.deal().unwrap();

        assert_eq!(
            dealt, expected,
            "deal after shuffle must start from the top"
        );
    }

    #[test]
    fn different_seeds_produce_different_orders() {
        let mut a = get_fresh_standard_deck();
        let mut b = get_fresh_standard_deck();

        a.shuffle(&mut seeded_rng(1));
        b.shuffle(&mut seeded_rng(2));

        let a_order: Vec<_> = a.cards.iter().collect();
        let b_order: Vec<_> = b.cards.iter().collect();

        assert_ne!(a_order, b_order);
    }

    #[test]
    fn deal_consumes_and_returns_the_correct_card() {
        let mut deck = get_fresh_standard_deck();

        let first_suit = SUITS[0];

        let card = deck.deal().unwrap();

        assert_eq!(card.rank, Rank::Two);
        assert_eq!(card.suit, first_suit);

        let card = deck.deal().unwrap();

        assert_eq!(card.rank, Rank::Three);
        assert_eq!(card.suit, first_suit);

        let card = deck.deal().unwrap();

        assert_eq!(card.rank, Rank::Four);
        assert_eq!(card.suit, first_suit);
    }

    #[test]
    fn deals_all_cards_then_returns_none_standard_52() {
        let mut deck = get_fresh_standard_deck();

        let mut dealt = Vec::new();

        while let Some(card) = deck.deal() {
            dealt.push(card);
        }

        assert_eq!(dealt.len(), 52);
        assert_eq!(dealt.into_iter().collect::<HashSet<_>>().len(), 52);
    }

    #[test]
    fn deal_n_returns_the_next_n_cards_in_order() {
        let mut deck = get_fresh_standard_deck();

        let cards = deck.deal_n::<3>().unwrap();

        assert_eq!(
            cards,
            [
                card(Rank::Two, SUITS[0]),
                card(Rank::Three, SUITS[0]),
                card(Rank::Four, SUITS[0])
            ]
        );
        assert_eq!(deck.remaining(), 49);
    }

    #[test]
    fn deal_n_is_all_or_nothing_when_the_deck_runs_low() {
        let mut deck = get_fresh_standard_deck();

        for _ in 0..50 {
            deck.deal();
        }
        assert_eq!(deck.remaining(), 2);

        assert_eq!(deck.deal_n::<3>(), None);
        assert_eq!(deck.remaining(), 2, "failed deal must not consume cards");

        assert!(deck.deal_n::<2>().is_some());
        assert_eq!(deck.remaining(), 0);
    }

    #[test]
    fn deal_n_can_deal_the_whole_deck() {
        let mut deck = get_fresh_standard_deck();

        let mut seen = HashSet::new();
        while let Some(cards) = deck.deal_n::<5>() {
            seen.extend(cards);
        }

        // 50 cards in ten 5-card chunks; the last 2 need single deals.
        assert_eq!(seen.len(), 50);
        assert_eq!(deck.remaining(), 2);
    }

    #[test]
    fn new_decks_are_sorted_two_first_ace_last() {
        let deck = get_fresh_standard_deck();

        for (i, block) in deck.cards.chunks(13).enumerate() {
            assert_eq!(block.first().unwrap().rank, Rank::Two);
            assert_eq!(block.last().unwrap().rank, Rank::Ace);
            assert_eq!(block.first().unwrap().suit, SUITS[i]);
            assert_eq!(block.last().unwrap().suit, SUITS[i]);
        }
    }
}
