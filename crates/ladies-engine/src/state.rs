use ladies_core::{Card, decks::StandardDeck};
use rand::{SeedableRng, rngs::StdRng};

use crate::player::Player;

pub type Chips = u64;
pub type Seat = usize;

pub const SMALL_BLIND: Chips = 1;
pub const BIG_BLIND: Chips = 2;
pub const BIG_BLIND_SEAT: Seat = 1;
pub const BUTTON: Seat = 0;

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Street {
    Preflop,
    Flop,
    Turn,
    River,
    Showdown,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Status {
    Active,
    Folded,
    AllIn,
}

#[derive(Clone)]
pub struct GameState {
    pub players: [Player; 2],
    pub street: Street,
    pub board: Vec<Card>,
    pub deck: Vec<Card>,
    pub current_bet: Chips,
    pub to_act: Seat,
    pub needs_action: [bool; 2],
}

impl GameState {
    pub fn new(seed: u64, stacks: [Chips; 2]) -> Self {
        let mut deck = StandardDeck::new();

        deck.shuffle(&mut StdRng::seed_from_u64(seed));

        let holes = [
            deck.deal_n::<2>().expect("52 cards"),
            deck.deal_n::<2>().expect("52 cards"),
        ];

        let mut undealt = Vec::with_capacity(deck.remaining());

        while let Some(card) = deck.deal() {
            undealt.push(card);
        }

        let mut players = [
            Player::new(holes[0], stacks[0]),
            Player::new(holes[1], stacks[1]),
        ];

        let board = Vec::with_capacity(5);

        players[BUTTON].post(SMALL_BLIND);
        players[BIG_BLIND_SEAT].post(BIG_BLIND);

        Self {
            street: Street::Preflop,
            current_bet: players[BIG_BLIND_SEAT].bet,
            board,
            players,
            deck: undealt,
            to_act: BUTTON,
            needs_action: [false, true],
        }
    }

    pub fn pot(&self) -> Chips {
        self.players.iter().map(|p| p.committed).sum()
    }
}

#[cfg(test)]
mod tests {

    use std::collections::HashSet;

    use ladies_core::Card;

    use crate::state::{BIG_BLIND, BIG_BLIND_SEAT, BUTTON, Chips, GameState, SMALL_BLIND};

    fn stacks() -> [Chips; 2] {
        [5000, 5000]
    }

    #[test]
    fn same_seed_deals_the_same_cards() {
        let seed = 1;

        let state = GameState::new(seed, stacks());

        let p1 = state.players[0].hole;
        let p2 = state.players[1].hole;

        let state = GameState::new(seed, stacks());

        assert_eq!(p1, state.players[0].hole);
        assert_eq!(p2, state.players[1].hole);
    }

    #[test]
    fn different_seed_deals_different_cards() {
        let state = GameState::new(1, stacks());

        let p1 = state.players[0].hole;
        let p2 = state.players[1].hole;

        let state = GameState::new(2, stacks());

        assert_ne!(p1, state.players[0].hole);
        assert_ne!(p2, state.players[1].hole);
    }

    #[test]
    fn new_games_post_blinds() {
        let state = GameState::new(1, stacks());

        assert_eq!(state.players[BIG_BLIND_SEAT].bet, BIG_BLIND);
        assert_eq!(state.players[BIG_BLIND_SEAT].stack, 4998);

        assert_eq!(state.players[BUTTON].bet, SMALL_BLIND);
        assert_eq!(state.players[BUTTON].stack, 4999);

        assert_eq!(state.pot(), 3);
    }

    #[test]
    fn dealing_consumes_four_cards_from_the_deck() {
        let state = GameState::new(1, stacks());

        assert_eq!(state.deck.len(), 48);

        let all: HashSet<Card> = state
            .players
            .iter()
            .flat_map(|p| p.hole)
            .chain(state.deck.iter().copied())
            .collect();

        assert_eq!(all.len(), 52);
    }
}
