use ladies_core::{Card, StandardDeck};
use rand::{SeedableRng, rngs::StdRng};

pub use blinds::Blinds;
pub use player::Player;
pub use pot::Pot;
pub use transition::{Action, IllegalAction, Street};

mod blinds;
mod player;
mod pot;
mod transition;

pub type Chips = u64;
pub type Seat = usize;

#[derive(Clone)]
pub struct Positions {
    pub sb: Seat,
    pub bb: Seat,
    pub button: Seat,
}

#[derive(Clone)]
pub struct HandState {
    pub players: Vec<Player>,
    pub street: Street,
    pub board: Vec<Card>,
    pub deck: Vec<Card>,
    pub current_bet: Chips,
    pub min_raise: Chips,
    pub blinds: Blinds,
    pub positions: Positions,
    pub to_act: Seat,
}

pub struct HandOptions {
    pub button: Seat,
    pub blinds: Blinds,
}

impl HandState {
    pub fn new(seed: u64, stacks: &[Chips], options: HandOptions) -> Self {
        let mut deck = StandardDeck::new();
        deck.shuffle(&mut StdRng::seed_from_u64(seed));

        let mut cards = Vec::with_capacity(52);
        while let Some(card) = deck.deal() {
            cards.push(card);
        }

        Self::from_deck(cards, stacks, options)
    }

    /// Exists so tests can rig hands deterministically.
    pub(crate) fn from_deck(cards: Vec<Card>, stacks: &[Chips], options: HandOptions) -> Self {
        let mut cards = cards;
        let holes: Vec<[Card; 2]> = (0..stacks.len())
            .map(|_| {
                let first = cards.remove(0);
                let second = cards.remove(0);
                [first, second]
            })
            .collect();

        let mut players: Vec<Player> = holes
            .into_iter()
            .zip(stacks)
            .map(|(hole, &stack)| Player::new(hole, stack))
            .collect();

        let (sb_seat, bb_seat) = get_blind_seats(options.button, &players);

        players[sb_seat].post(options.blinds.small);
        players[bb_seat].post(options.blinds.big);

        for player in &mut players {
            player.needs_action = player.can_play();
        }

        Self {
            street: Street::Preflop,
            current_bet: options.blinds.big,
            min_raise: options.blinds.big * 2,
            blinds: options.blinds,
            board: Vec::with_capacity(5),
            deck: cards,
            positions: Positions {
                sb: sb_seat,
                bb: bb_seat,
                button: options.button,
            },
            to_act: first_to_act_preflop(sb_seat, bb_seat, &players),
            players,
        }
    }

    pub fn pot(&self) -> Chips {
        pot::total(&self.players)
    }

    /// The pot split into layers at each distinct all-in contribution,
    /// ordered from the main pot upward. Sums to [`HandState::pot`]; empty
    /// once the hand is over.
    pub fn pots(&self) -> Vec<Pot> {
        pot::layers(&self.players)
    }

    /// The main pot: the bottom layer, the chips every remaining player
    /// has matched. `None` once the hand is over.
    pub fn main_pot(&self) -> Option<Pot> {
        self.pots().into_iter().next()
    }

    pub fn stacks(&self) -> Vec<Chips> {
        self.players.iter().map(|p| p.stack).collect()
    }

    pub fn is_hand_over(&self) -> bool {
        self.street == Street::Complete
    }
}

fn next_seat(seat: Seat, table_size: usize) -> Seat {
    (seat + 1) % table_size
}

fn next_active_from(seat: Seat, players: &[Player]) -> Seat {
    let table_size = players.len();

    (0..table_size)
        .map(|offset| next_seat(seat + offset, table_size))
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

fn get_blind_seats(button: Seat, players: &[Player]) -> (Seat, Seat) {
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

    use std::{collections::HashSet, str::FromStr};

    use ladies_core::Card;

    use crate::state::{
        Blinds, Chips, HandOptions, HandState, Player, Seat, next_active_from, next_seat,
        player::Status,
    };

    const STARTING_STACK: Chips = 5000;

    fn stacks<const N: Seat>() -> [Chips; N] {
        [STARTING_STACK; N]
    }

    fn player(status: Status) -> Player {
        Player {
            stack: 2000,
            bet: 0,
            committed: 0,
            hole: [Card::from_str("Ad").unwrap(), Card::from_str("Kd").unwrap()],
            status,
            needs_action: false,
        }
    }

    const OPTIONS: HandOptions = HandOptions {
        button: 0,
        blinds: Blinds {
            small: 100,
            big: 200,
        },
    };
    fn with_button(button: Seat) -> HandOptions {
        HandOptions { button, ..OPTIONS }
    }

    #[test]
    fn next_seat_returns_the_next_seat_index_from_a_target() {
        assert_eq!(next_seat(7, 8), 0);
        assert_eq!(next_seat(2, 5), 3);
        assert_eq!(next_seat(0, 1), 0);
        assert_eq!(next_seat(0, 2), 1);
        assert_eq!(next_seat(1, 2), 0);
    }

    #[test]
    fn next_active_from_only_finds_players_who_can_play() {
        let players = [
            player(Status::Folded),
            player(Status::AllIn),
            player(Status::Active),
            player(Status::Folded),
            player(Status::Active),
            player(Status::Folded),
        ];

        assert_eq!(next_active_from(1, &players), 2);
        assert_eq!(next_active_from(2, &players), 4);
        assert_eq!(next_active_from(4, &players), 2);
    }

    #[test]
    fn same_seed_deals_the_same_cards() {
        let seed = 1;

        let state = HandState::new(seed, &stacks::<2>(), OPTIONS);

        let p1 = state.players[0].hole;
        let p2 = state.players[1].hole;

        let state = HandState::new(seed, &stacks::<2>(), OPTIONS);

        assert_eq!(p1, state.players[0].hole);
        assert_eq!(p2, state.players[1].hole);
    }

    #[test]
    fn preflop_first_to_act_is_sb_in_heads_up() {
        let state = HandState::new(0, &stacks::<2>(), OPTIONS);
        assert_eq!(state.to_act, state.positions.sb);

        let state = HandState::new(1, &stacks::<2>(), OPTIONS);
        assert_eq!(state.to_act, state.positions.sb);
    }

    #[test]
    fn preflop_first_to_act_is_left_of_bb_in_multiway() {
        let state = HandState::new(0, &stacks::<3>(), OPTIONS);

        assert_eq!(
            state.to_act,
            next_seat(state.positions.bb, state.players.len())
        );

        let state = HandState::new(1, &stacks::<3>(), OPTIONS);

        assert_eq!(
            state.to_act,
            next_seat(state.positions.bb, state.players.len())
        );

        let state = HandState::new(2, &stacks::<3>(), OPTIONS);

        assert_eq!(
            state.to_act,
            next_seat(state.positions.bb, state.players.len())
        );
    }

    #[test]
    fn assigns_blind_seats_correctly_in_heads_up() {
        let state = HandState::new(0, &stacks::<2>(), with_button(0));

        assert_eq!(state.positions.sb, 0);
        assert_eq!(state.positions.bb, 1);

        let state = HandState::new(0, &stacks::<2>(), with_button(1));

        assert_eq!(state.positions.sb, 1);
        assert_eq!(state.positions.bb, 0);
    }

    #[test]
    fn assigns_blind_seats_correctly_in_multiway() {
        let state = HandState::new(1, &stacks::<3>(), with_button(0));

        assert_eq!(state.positions.sb, 1);
        assert_eq!(state.positions.bb, 2);

        let state = HandState::new(1, &stacks::<3>(), with_button(1));

        assert_eq!(state.positions.sb, 2);
        assert_eq!(state.positions.bb, 0);
    }

    #[test]
    fn different_seed_deals_different_cards() {
        let state = HandState::new(1, &stacks::<2>(), OPTIONS);

        let p1 = state.players[0].hole;
        let p2 = state.players[1].hole;

        let state = HandState::new(2, &stacks::<2>(), OPTIONS);

        assert_ne!(p1, state.players[0].hole);
        assert_ne!(p2, state.players[1].hole);
    }

    #[test]
    fn short_stack_posts_all_in_from_the_blind() {
        // seat 1 is SB with 50 < small blind 100
        let state = HandState::new(1, &[5000, 50, 5000], OPTIONS);

        let sb = &state.players[1];
        assert_eq!(sb.bet, 50);
        assert_eq!(sb.stack, 0);
        assert!(!sb.can_play());
        assert!(!sb.needs_action);

        assert_eq!(state.to_act, next_seat(state.positions.bb, 3));
    }

    #[test]
    fn heads_up_games_post_blind_from_button() {
        let state = HandState::new(1, &stacks::<2>(), OPTIONS);
        let bb = &state.players[state.positions.bb];

        assert_eq!(state.positions.bb, state.positions.button + 1);

        assert_eq!(bb.bet, OPTIONS.blinds.big);
        assert_eq!(bb.stack, STARTING_STACK - OPTIONS.blinds.big);

        assert_eq!(state.players[OPTIONS.button].bet, OPTIONS.blinds.small);
        assert_eq!(
            state.players[OPTIONS.button].stack,
            STARTING_STACK - OPTIONS.blinds.small
        );

        assert_eq!(state.pot(), OPTIONS.blinds.small + OPTIONS.blinds.big);
    }

    #[test]
    fn multiway_games_post_blinds_after_the_button() {
        let state = HandState::new(1, &stacks::<3>(), OPTIONS);

        assert_eq!(state.positions.bb, state.positions.sb + 1);
        assert_eq!(state.positions.sb, state.positions.button + 1);

        assert_eq!(state.players[1].bet, OPTIONS.blinds.small);
        assert_eq!(state.players[2].bet, OPTIONS.blinds.big);
        assert_eq!(state.players[0].bet, 0);
        assert_eq!(state.pot(), OPTIONS.blinds.small + OPTIONS.blinds.big);
    }

    #[test]
    fn dealing_consumes_cards_from_the_deck() {
        let state = HandState::new(1, &stacks::<2>(), OPTIONS);

        assert_eq!(state.deck.len(), 48);

        let all: HashSet<Card> = state
            .players
            .iter()
            .flat_map(|p| p.hole)
            .chain(state.deck.iter().copied())
            .collect();

        assert_eq!(all.len(), 52);

        assert!(state.board.is_empty());

        let state = HandState::new(1, &stacks::<3>(), OPTIONS);

        assert_eq!(state.deck.len(), 46);

        let all: HashSet<Card> = state
            .players
            .iter()
            .flat_map(|p| p.hole)
            .chain(state.deck.iter().copied())
            .collect();

        assert_eq!(all.len(), 52);
        assert!(state.board.is_empty());
    }

    #[test]
    fn current_bet_is_correct_after_blinds() {
        let state = HandState::new(0, &stacks::<2>(), OPTIONS);

        assert_eq!(state.current_bet, OPTIONS.blinds.big);
    }

    #[test]
    fn active_players_start_needing_action() {
        let state = HandState::new(1, &stacks::<3>(), OPTIONS);

        for player in &state.players {
            assert_eq!(player.needs_action, player.can_play());
        }
    }
}
