use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Flex, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Paragraph},
};

use crate::app::{App, Field};

fn selected_style(selected: bool) -> Style {
    if selected {
        Style::new().fg(Color::Yellow).add_modifier(Modifier::BOLD)
    } else {
        Style::new()
    }
}

pub(crate) fn config_ui(frame: &mut Frame, app: &App) {
    let [area] = Layout::vertical([Constraint::Percentage(35)])
        .flex(Flex::Center)
        .areas(frame.area());
    let [card] = Layout::horizontal([Constraint::Length(44)])
        .flex(Flex::Center)
        .areas(area);

    let block = Block::bordered().title(" Session setup ");
    let inner = block.inner(card);
    frame.render_widget(block, card);

    let rows = Layout::vertical([
        Constraint::Length(1), // players
        Constraint::Length(1), // chips
        Constraint::Length(1), // small blind
        Constraint::Length(1), // big blind note
        Constraint::Length(1), // blank
        Constraint::Length(1), // start button
        Constraint::Length(1), // error
    ])
    .areas::<7>(inner);

    let players = Line::from(vec![
        Span::raw("Players:  "),
        Span::raw("◄ "),
        Span::styled(
            app.players.to_string(),
            selected_style(app.field == Field::Players),
        ),
        Span::raw(" ►"),
    ]);
    frame.render_widget(Paragraph::new(players), rows[0]);

    let chips = Line::from(vec![
        Span::raw("Starting chips: "),
        Span::styled(
            format!("[{}]", app.chips_text),
            selected_style(app.field == Field::Chips),
        ),
        Span::raw(if app.field == Field::Chips { "_" } else { " " }),
    ]);
    frame.render_widget(Paragraph::new(chips), rows[1]);

    let small = Line::from(vec![
        Span::raw("Small blind:    "),
        Span::styled(
            format!("[{}]", app.small_text),
            selected_style(app.field == Field::SmallBlind),
        ),
        Span::raw(if app.field == Field::SmallBlind {
            "_"
        } else {
            " "
        }),
    ]);
    frame.render_widget(Paragraph::new(small), rows[2]);

    frame.render_widget(
        Paragraph::new(Line::styled(
            format!("Big blind: {}", app.big_blind()),
            Style::new().fg(Color::DarkGray),
        )),
        rows[3],
    );

    let start_style = if app.field == Field::Start {
        Style::new().fg(Color::Green).add_modifier(Modifier::BOLD)
    } else {
        Style::new()
    };
    let start = Line::styled("[ Start session ]", start_style).alignment(Alignment::Center);
    frame.render_widget(Paragraph::new(start), rows[5]);

    if let Some(error) = &app.error {
        frame.render_widget(
            Paragraph::new(Line::styled(error.clone(), Style::new().fg(Color::Red))),
            rows[6],
        );
    }
}

pub(crate) fn session_ui(frame: &mut Frame, app: &App) {
    let session = app.session.as_ref().unwrap();
    let lines = vec![
        Line::from("Session started"),
        Line::from(""),
        Line::from(format!("Players:       {}", app.players)),
        Line::from(format!("Starting chips: {}", app.chips)),
        Line::from(format!(
            "Blinds:         {}/{}",
            app.small_blind,
            app.big_blind()
        )),
        Line::from(""),
        Line::from(format!("Stacks: {:?}", session.stacks())),
        Line::from(""),
        Line::from("Press q to quit"),
    ];
    frame.render_widget(
        Paragraph::new(lines).block(Block::bordered().title(" Ladies ")),
        frame.area(),
    );
}
