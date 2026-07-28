use taskboard_core::{Briefing, ProjectSummary, Task, TaskDetail};

pub fn print_briefing(b: &Briefing) {
    let p = &b.project;
    println!("📋 {}  ({})", p.name, p.path);
    println!();
    if !p.original_request.is_empty() {
        println!("── Original request ──");
        println!("{}", p.original_request);
        println!();
    }
    if !p.plan_summary.is_empty() {
        println!("── Approved plan ──");
        println!("{}", p.plan_summary);
        println!();
    }
    if !p.last_actor.is_empty() || p.current_task_id.is_some() || !p.handoff_note.is_empty() {
        println!("── Handoff (where the last AI stopped) ──");
        if !p.last_actor.is_empty() {
            println!("  last actor:  {}", p.last_actor);
        }
        if !p.last_session_id.is_empty() {
            println!("  session id:  {}", p.last_session_id);
        }
        if let Some(id) = p.current_task_id {
            println!("  stopped at:  #{id}");
        }
        if !p.handoff_note.is_empty() {
            println!(
                "  note:        {}",
                p.handoff_note.replace('\n', "\n               ")
            );
        }
        if let Some(ts) = &p.handoff_updated_at {
            println!("  updated:     {ts}");
        }
        println!();
    }
    match &b.resume_task {
        Some(t) => println!("▶ Resume at #{} [{}] {}", t.id, t.status, t.title),
        None => println!("▶ Nothing to resume — no open tasks."),
    }
    println!();
    print_tasks(&b.tasks);
}

pub fn print_projects(projects: &[ProjectSummary]) {
    if projects.is_empty() {
        println!("No projects yet.");
        return;
    }
    println!(
        "{:<4} {:<24} {:>5} {:>8} {:>12} {:>7} {:>5}  PATH",
        "ID", "NAME", "OPEN", "WAITING", "IN_PROGRESS", "REVIEW", "DONE"
    );
    for p in projects {
        println!(
            "{:<4} {:<24} {:>5} {:>8} {:>12} {:>7} {:>5}  {}",
            p.project.id,
            truncate(&p.project.name, 24),
            p.open,
            p.waiting,
            p.in_progress,
            p.review,
            p.done,
            p.project.path
        );
    }
}

pub fn print_tasks(tasks: &[Task]) {
    if tasks.is_empty() {
        println!("No tasks.");
        return;
    }
    println!(
        "{:<5} {:<12} {:<5} {:<8} {:<14} {:<16} TITLE",
        "ID", "STATUS", "KIND", "PRIO", "ASSIGNEE", "PROJECT"
    );
    for t in tasks {
        println!(
            "{:<5} {:<12} {:<5} {:<8} {:<14} {:<16} {}",
            format!("#{}", t.id),
            t.status,
            t.kind,
            t.priority,
            truncate(&t.assignee, 14),
            truncate(&t.project_name, 16),
            t.title
        );
    }
}

pub fn print_detail(d: &TaskDetail) {
    let t = &d.task;
    println!("#{} [{}] {}", t.id, t.status, t.title);
    println!(
        "project: {}   kind: {}   priority: {}   assignee: {}",
        t.project_name,
        t.kind,
        t.priority,
        if t.assignee.is_empty() {
            "-"
        } else {
            &t.assignee
        }
    );
    println!("created: {}   updated: {}", t.created_at, t.updated_at);
    if !t.description.is_empty() {
        println!("\n{}", t.description);
    }
    if !d.depends_on.is_empty() {
        println!("\ndepends on:");
        for r in &d.depends_on {
            println!("  #{} [{}] {}", r.id, r.status, r.title);
        }
    }
    if !d.blocks.is_empty() {
        println!("\nblocks:");
        for r in &d.blocks {
            println!("  #{} [{}] {}", r.id, r.status, r.title);
        }
    }
    if !d.comments.is_empty() {
        println!("\ncomments:");
        for c in &d.comments {
            println!(
                "  [{}] {}:\n    {}",
                c.created_at,
                c.author,
                c.body.replace('\n', "\n    ")
            );
        }
    }
    if !d.events.is_empty() {
        println!("\nactivity:");
        for e in &d.events {
            println!("  [{}] {} {} {}", e.created_at, e.actor, e.kind, e.detail);
        }
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{cut}…")
    }
}
