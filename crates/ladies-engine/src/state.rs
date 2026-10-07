use ladies_core::{Card, decks::StandardDeck};
use rand::{SeedableRng, rngs::StdRng};

pub use crate::state::blinds::Blinds;
pub use crate::state::player::Player;
pub use crate::state::street::Street;

mod action;
mod blinds;
mod player;
mod step;
mod street;

pub type Chips = u64;
pub type Seat = usize;

#[derive(Clone)]
struct GameStatePositions {
    sb: Seat,
    bb: Seat,
    button: Seat,
    to_act: Seat,
}

#[derive(Clone)]
pub struct GameState {
    pub players: Vec<Player>,
    pub street: Street,
    pub board: Vec<Card>,
    pub deck: Vec<Card>,
    pub current_bet: Chips,
    pub positions: GameStatePositions,
}

pub struct GameStateInitOptions {
    button: usize,
    blinds: Blinds,
}

impl GameState {
    pub fn new(seed: u64, stacks: &[Chips], options: GameStateInitOptions) -> Self {
        let mut deck = StandardDeck::new();

        deck.shuffle(&mut StdRng::seed_from_u64(seed));

        let mut players = setup_players(&mut deck, stacks);
        let (board, deck) = prepare_cards(&mut deck);
        let (sb_seat, bb_seat) = get_blind_seats(options.button, &players);

        players[sb_seat].post(options.blinds.small);
        players[bb_seat].post(options.blinds.big);

        Self {
            street: Street::Preflop,
            current_bet: players[bb_seat].bet,
            board,
            deck,
            positions: GameStatePositions {
                sb: sb_seat,
                bb: bb_seat,
                button: options.button,
                to_act: first_to_act_preflop(sb_seat, bb_seat, &players),
            },
            players,
        }
    }

    pub fn pot(&self) -> Chips {
        self.players.iter().map(|p| p.committed).sum()
    }

    fn next_active(&self, from: Seat) -> Seat {
        next_active_from(from, &self.players)
    }
}

fn next_active_from(seat: Seat, players: &[Player]) -> Seat {
    let n = players.len();
    (1..=n)
        .map(|offset| next_seat(seat + offset, n))
        .find(|&s| players[s].can_play())
        .expect("No active player remains")
}

fn first_to_act_preflop(sb_seat: Seat, bb_seat: Seat, players: &[Player]) -> Seat {
    if players.len() == 2 {
        sb_seat
    } else {
        next_active_from(bb_seat, players)
    }
}

fn setup_players(deck: &mut StandardDeck, stacks: &[Chips]) -> Vec<Player> {
    let holes: Vec<[Card; 2]> = (0..stacks.len())
        .map(|_| deck.deal_n::<2>().expect("52 cards"))
        .collect();

    holes
        .iter()
        .zip(stacks)
        .map(|(&hole, &stack)| Player::new(hole, stack))
        .collect()
}

fn prepare_cards(deck: &mut StandardDeck) -> (Vec<Card>, Vec<Card>) {
    let board = Vec::with_capacity(5);
    let mut undealt = Vec::with_capacity(deck.remaining());

    while let Some(card) = deck.deal() {
        undealt.push(card);
    }

    (board, undealt)
}

fn next_seat(seat: Seat, table_size: usize) -> Seat {
    (seat + 1) % table_size
}

fn get_blind_seats(button: usize, players: &[Player]) -> (usize, usize) {
    let sb_seat = if players.len() == 2 {
        button
    } else {
        next_seat(button, players.len())
    };
    let bb_seat = next_seat(sb_seat, players.len());

    (sb_seat, bb_seat)
}

#[cfg(test)]
mod tests {

    use std::collections::HashSet;

    use ladies_core::Card;

    use crate::state::{Blinds, Chips, GameState, GameStateInitOptions};

    const STARTING_STACK: Chips = 5000;

    fn stacks<const N: usize>() -> [Chips; N] {
        [STARTING_STACK; N]
    }

    const OPTIONS: GameStateInitOptions = GameStateInitOptions {
        button: 0,
        blinds: Blinds {
            small: 100,
            big: 200,
        },
    };

    #[test]
    fn same_seed_deals_the_same_cards() {
        let seed = 1;

        let state = GameState::new(seed, &stacks::<2>(), OPTIONS);

        let p1 = state.players[0].hole;
        let p2 = state.players[1].hole;

        let state = GameState::new(seed, &stacks::<2>(), OPTIONS);

        assert_eq!(p1, state.players[0].hole);
        assert_eq!(p2, state.players[1].hole);
    }

    #[test]
    fn different_seed_deals_different_cards() {
        let state = GameState::new(1, &stacks::<2>(), OPTIONS);

        let p1 = state.players[0].hole;
        let p2 = state.players[1].hole;

        let state = GameState::new(2, &stacks::<2>(), OPTIONS);

        assert_ne!(p1, state.players[0].hole);
        assert_ne!(p2, state.players[1].hole);
    }

    #[test]
    fn heads_up_games_post_blind_from_button() {
        let state = GameState::new(1, &stacks::<2>(), OPTIONS);
        let bb_seat = 1; // heads-up: seat after the button/SB

        assert_eq!(state.players[bb_seat].bet, OPTIONS.blinds.big);
        assert_eq!(
            state.players[bb_seat].stack,
            STARTING_STACK - OPTIONS.blinds.big
        );

        assert_eq!(state.players[OPTIONS.button].bet, OPTIONS.blinds.small);
        assert_eq!(
            state.players[OPTIONS.button].stack,
            STARTING_STACK - OPTIONS.blinds.small
        );

        assert_eq!(state.pot(), 3);
    }

    #[test]
    fn multiway_games_post_blinds_after_the_button() {
        let state = GameState::new(1, &stacks::<3>(), OPTIONS);

        assert_eq!(state.players[1].bet, OPTIONS.blinds.small);
        assert_eq!(state.players[2].bet, OPTIONS.blinds.big);
        assert_eq!(state.players[0].bet, 0);
        assert_eq!(state.pot(), 3);
    }

    #[test]
    fn dealing_consumes_cards_from_the_deck() {
        let state = GameState::new(1, &stacks::<2>(), OPTIONS);

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
