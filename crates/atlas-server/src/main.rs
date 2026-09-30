//! The `atlas` binary: `serve`, `healthcheck`, `export-types`.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use clap::{Parser, Subcommand};

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[derive(Parser, Debug)]
#[command(
    name = "atlas",
    version,
    about = "Flux Atlas: live map and explorer of the Flux network"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Run the server.
    Serve {
        /// Listen address.
        #[arg(long, env = "ATLAS_BIND", default_value = "0.0.0.0:3000")]
        bind: SocketAddr,
        /// Directory holding the database.
        #[arg(long, env = "ATLAS_DATA_DIR", default_value = "/data")]
        data_dir: PathBuf,
    },
    /// Probe a running server's `/healthz`; exit status 0 when healthy (container HEALTHCHECK).
    Healthcheck {
        #[arg(long, env = "ATLAS_HEALTHCHECK_ADDR", default_value = "127.0.0.1:3000")]
        addr: SocketAddr,
        #[arg(long, default_value_t = 3)]
        timeout_s: u64,
    },
    /// Write the TypeScript API bindings (ts-rs) into a directory.
    ExportTypes {
        #[arg(long, default_value = "web/src/api/generated")]
        out: PathBuf,
    },
}

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_env("ATLAS_LOG")
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stdout()))
        .init();
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.cmd {
        Cmd::Serve { bind, data_dir } => {
            init_tracing();
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .map_err(anyhow::Error::from)
                .and_then(|rt| {
                    rt.block_on(atlas_server::serve(atlas_server::ServeConfig {
                        bind,
                        data_dir,
                    }))
                })
        }
        Cmd::Healthcheck { addr, timeout_s } => tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(anyhow::Error::from)
            .and_then(|rt| {
                rt.block_on(atlas_server::healthcheck(
                    addr,
                    Duration::from_secs(timeout_s),
                ))
            }),
        Cmd::ExportTypes { out } => atlas_core::export_typescript(&out)
            .map(|()| eprintln!("wrote TypeScript bindings to {}", out.display()))
            .map_err(anyhow::Error::from),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("atlas: {e:#}");
            ExitCode::FAILURE
        }
    }
}
