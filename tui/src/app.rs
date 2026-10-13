use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ladies_session::Session;
use ladies_sim::{Blinds, Chips};

pub(crate) const MIN_PLAYERS: usize = 2;
pub(crate) const MAX_PLAYERS: usize = 9;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Field {
    Players,
    Chips,
    SmallBlind,
    Start,
}

const FIELDS: [Field; 4] = [
    Field::Players,
    Field::Chips,
    Field::SmallBlind,
    Field::Start,
];

impl Field {
    fn next(self) -> Self {
        let i = FIELDS.iter().position(|&f| f == self).unwrap();
        FIELDS[(i + 1) % FIELDS.len()]
    }

    fn prev(self) -> Self {
        let i = FIELDS.iter().position(|&f| f == self).unwrap();
        FIELDS[(i + FIELDS.len() - 1) % FIELDS.len()]
    }
}

/// Parses a draft text field into a positive integer, or `None` while the
/// input is empty/partial so typing isn't fought by clamping.
fn parse_count(text: &str) -> Option<u64> {
    text.trim().parse::<u64>().ok().filter(|&v| v >= 1)
}

pub(crate) struct App {
    pub(crate) field: Field,
    pub(crate) players: usize,
    pub(crate) chips_text: String,
    pub(crate) small_text: String,
    pub(crate) chips: Chips,
    pub(crate) small_blind: Chips,
    pub(crate) session: Option<Session>,
    pub(crate) error: Option<String>,
}

impl App {
    pub(crate) fn new() -> Self {
        Self {
            field: Field::Players,
            players: 3,
            chips_text: "5000".into(),
            small_text: "100".into(),
            chips: 5000,
            small_blind: 100,
            session: None,
            error: None,
        }
    }

    pub(crate) fn big_blind(&self) -> Chips {
        self.small_blind * 2
    }

    /// Handles a key press. Returns `true` when the app should quit.
    pub(crate) fn on_key(&mut self, key: KeyEvent) -> bool {
        let code = key.code;
        if key.modifiers.contains(KeyModifiers::CONTROL) && code == KeyCode::Char('c') {
            return true;
        }

        if self.session.is_some() {
            return matches!(code, KeyCode::Char('q') | KeyCode::Esc);
        }

        match code {
            KeyCode::Char('q') | KeyCode::Esc => true,
            KeyCode::Tab => {
                self.field = self.field.next();
                false
            }
            KeyCode::BackTab | KeyCode::Up => {
                self.field = self.field.prev();
                false
            }
            KeyCode::Down => {
                self.field = self.field.next();
                false
            }
            KeyCode::Enter => {
                self.start_session();
                false
            }
            key => {
                self.handle_key(key);
                false
            }
        }
    }

    fn handle_key(&mut self, key: KeyCode) {
        match self.field {
            Field::Players => match key {
                KeyCode::Left => self.players = (self.players - 1).max(MIN_PLAYERS),
                KeyCode::Right => self.players = (self.players + 1).min(MAX_PLAYERS),
                _ => {}
            },
            Field::Chips => match key {
                KeyCode::Char(c) if c.is_ascii_digit() => {
                    self.chips_text.push(c);
                    if let Some(chips) = parse_count(&self.chips_text) {
                        self.chips = chips;
                    }
                }
                KeyCode::Backspace => {
                    self.chips_text.pop();
                    if let Some(chips) = parse_count(&self.chips_text) {
                        self.chips = chips;
                    }
                }
                _ => {}
            },
            Field::SmallBlind => match key {
                KeyCode::Char(c) if c.is_ascii_digit() => {
                    self.small_text.push(c);
                    if let Some(small) = parse_count(&self.small_text) {
                        self.small_blind = small;
                    }
                }
                KeyCode::Backspace => {
                    self.small_text.pop();
                    if let Some(small) = parse_count(&self.small_text) {
                        self.small_blind = small;
                    }
                }
                _ => {}
            },
            Field::Start => {}
        }
    }

    /// Commit draft text like the web card: invalid/partial input falls back
    /// to the last valid value on submit.
    fn commit(&mut self) {
        if let Some(chips) = parse_count(&self.chips_text) {
            self.chips = chips;
        }
        if let Some(small) = parse_count(&self.small_text) {
            self.small_blind = small;
        }
        self.chips_text = self.chips.to_string();
        self.small_text = self.small_blind.to_string();
    }

    fn start_session(&mut self) {
        self.commit();
        let stacks = vec![self.chips; self.players];
        match Blinds::new(self.small_blind, self.big_blind()) {
            Ok(blinds) => {
                let mut session = Session::new(blinds, &stacks);
                match session.start_hand(1) {
                    Ok(()) => {
                        self.session = Some(session);
                        self.error = None;
                    }
                    Err(e) => self.error = Some(format!("{e:?}")),
                }
            }
            Err(e) => self.error = Some(format!("{e:?}")),
        }
    }
}
