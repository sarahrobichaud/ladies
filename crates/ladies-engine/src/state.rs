use ladies_core::{Card, decks::StandardDeck};
use rand::{SeedableRng, rngs::{self, StdRng}};

use crate::player::Player;

pub type Chips = u64;
pub type Seat = usize;


pub const SMALL_BLIND: Chips = 1;
pub const BIG_BLIND: Chips = 2;
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

pub struct GameState {
    players: [Player; 2],
    street: Street,
    board: Vec<Card>,
    deck: Vec<Card>,
    current_bet: Chips,
    to_act: Seat
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
            undealt.push(card)
        }

        let mut players = [
            Player::new(holes[0], stacks[0]),
            Player::new(holes[1], stacks[1]),
        ];

        let board = Vec::with_capacity(5);

        players[BUTTON].post(SMALL_BLIND);

        Self {
            street: Street::Preflop,
            current_bet: players[BUTTON + 1].bet,
            board,
            players,
            deck: undealt,
            to_act: BUTTON
        }
    }

    pub fn pot(&self) -> Chips {
        self.players.iter().map(|p| p.committed).sum()
    }

}
