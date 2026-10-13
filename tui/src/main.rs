mod app;
mod ui;

use std::time::Duration;

use crossterm::event::{self, Event, KeyEventKind};
use ratatui::DefaultTerminal;

use crate::app::App;

fn main() -> std::io::Result<()> {
    let mut terminal = ratatui::init();
    let result = run(&mut terminal);
    ratatui::restore();
    result
}

fn run(terminal: &mut DefaultTerminal) -> std::io::Result<()> {
    let mut app = App::new();
    loop {
        terminal.draw(|frame| match &app.session {
            Some(_) => ui::session_ui(frame, &app),
            None => ui::config_ui(frame, &app),
        })?;

        if !event::poll(Duration::from_millis(100))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }

        if app.on_key(key) {
            return Ok(());
        }
    }
}
