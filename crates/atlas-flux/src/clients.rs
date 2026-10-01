//! Typed upstream clients: FluxOS (gateway plus direct-node failover), Insight (main plus
//! mirrors), stats.runonflux.io, per-node FluxOS APIs (SSRF-guarded), and CoinGecko.

use std::sync::Arc;
use std::time::Duration;

use atlas_core::Hash32;
use serde::de::DeserializeOwned;
use url::Url;

use crate::envelope::{parse_envelope, parse_plain};
use crate::error::{FluxError, Result};
use crate::http::{Fetched, HttpClient, HttpConfig, RequestOpts, join};
use crate::models::apps::{
    AppLocation, DeploymentInformation, InstallingError, InstallingLocation, PermanentMessage,
    RawAppSpec, TemporaryMessage,
};
use crate::models::daemon::{
    BlockDeltas, BlockchainInfo, CurrentWinners, DaemonBlock, DaemonInfo, DaemonTx, FluxnodeCount,
    MempoolInfo, PendingNodeEntry, RawMempool, TxOutSetInfo,
};
use crate::models::insight::{
    CirculatingSupply, CoinGeckoSimplePrice, InsightAddrSummary, InsightAddrTxs, InsightBlock,
    InsightBlocksPage, InsightStatusInfo, InsightSync, InsightTx, InsightTxsPage, InsightUtxo,
    LastBlockHash, MarketsInfo, RichListRow, StatPoint,
};
use crate::models::node_api::{
    Bench, ConnectedPeerInfo, FluxInfo, Geolocation, HealthReport, PeerLink, RunningContainer,
    Topology,
};
use crate::models::nodes::NodeListEntry;
use crate::models::stats::{FluxLocation, HistoryStats, MarketplaceApp, StatsNodeRow};
use crate::ssrf::GuardedEndpoint;
use crate::upstream::{
    COINGECKO_BASE, FLUXOS_GATEWAY, FailoverSet, INSIGHT_BASES, STATS_BASE, Upstream,
};

/// Timeout for multi-megabyte bodies (node list, specs, locations, stats rounds).
pub const BIG_TIMEOUT: Duration = Duration::from_secs(60);
/// Size cap for multi-megabyte bodies.
pub const BIG_BODY: usize = 64 * 1024 * 1024;
/// The full permanent-message history is about 93 MB raw.
pub const HUGE_BODY: usize = 256 * 1024 * 1024;

/// Percent-encodes one path segment.
fn seg(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.trim().as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

fn big() -> RequestOpts {
    RequestOpts::default()
        .timeout(BIG_TIMEOUT)
        .max_bytes(BIG_BODY)
}

/// A conditionally fetched value.
#[derive(Debug, Clone)]
pub enum Conditional<T> {
    Modified { value: T, etag: Option<String> },
    NotModified,
}

async fn fetch_on(
    http: &HttpClient,
    u: &Upstream,
    path: &str,
    opts: &RequestOpts,
) -> Result<Fetched> {
    match &u.node {
        Some(ep) => http.get_node(ep, path, opts).await.map(Fetched::Body),
        None => http.get(&join(&u.base, path)?, opts).await,
    }
}

/// FluxOS API client: the gateway first, then healthy direct nodes.
#[derive(Clone, Debug)]
pub struct FluxOsClient {
    http: HttpClient,
    set: Arc<FailoverSet>,
}

/// Filter for `/apps/permanentmessages`.
#[derive(Debug, Clone, Copy)]
pub enum MessageFilter<'a> {
    /// Full history (about 24.5 MB br / 93 MB raw, about 7 s). Bootstrap only.
    All,
    Hash(&'a Hash32),
    AppName(&'a str),
    Owner(&'a str),
}

impl FluxOsClient {
    pub fn new(http: HttpClient, gateway: &str) -> Result<Self> {
        Ok(Self {
            http,
            set: Arc::new(FailoverSet::new("fluxos", &[gateway])?),
        })
    }

    /// Replaces the pool of direct-node secondaries (the engine feeds healthy nodes).
    pub fn set_failover_nodes(&self, nodes: &[GuardedEndpoint]) {
        self.set.set_nodes(nodes);
    }

    pub fn failover(&self) -> &FailoverSet {
        &self.set
    }

    /// GET a FluxOS path through the failover set and parse the envelope's `data`.
    pub async fn get<T: DeserializeOwned>(
        &self,
        what: &'static str,
        path: &str,
        opts: &RequestOpts,
    ) -> Result<T> {
        self.set
            .run(|u| async move {
                match fetch_on(&self.http, &u, path, opts).await? {
                    Fetched::Body(b) => Ok((parse_envelope::<T>(what, &b.bytes)?, b.elapsed)),
                    Fetched::NotModified => Err(FluxError::Parse {
                        what,
                        message: "unexpected 304".into(),
                    }),
                }
            })
            .await
    }

    /// Conditional GET (ETag / 304) of a FluxOS path.
    pub async fn get_conditional<T: DeserializeOwned>(
        &self,
        what: &'static str,
        path: &str,
        opts: &RequestOpts,
    ) -> Result<Conditional<T>> {
        self.set
            .run(|u| async move {
                match fetch_on(&self.http, &u, path, opts).await? {
                    Fetched::Body(b) => {
                        let value = parse_envelope::<T>(what, &b.bytes)?;
                        Ok((
                            Conditional::Modified {
                                value,
                                etag: b.etag,
                            },
                            b.elapsed,
                        ))
                    }
                    Fetched::NotModified => Ok((Conditional::NotModified, Duration::ZERO)),
                }
            })
            .await
    }

    /// Raw envelope body bytes (for callers that parse themselves, for example benchmarks).
    pub async fn get_raw(&self, path: &str, opts: &RequestOpts) -> Result<bytes::Bytes> {
        self.set
            .run(|u| async move {
                match fetch_on(&self.http, &u, path, opts).await? {
                    Fetched::Body(b) => Ok((b.bytes, b.elapsed)),
                    Fetched::NotModified => Err(FluxError::Parse {
                        what: "raw",
                        message: "unexpected 304".into(),
                    }),
                }
            })
            .await
    }

    // ----- daemon: chain -----

    /// `getblock/<hash|height>` at verbosity 2 (every tx decoded).
    pub async fn get_block(&self, hash_or_height: &str) -> Result<DaemonBlock> {
        self.get(
            "getblock",
            &format!("daemon/getblock/{}/2", seg(hash_or_height)),
            &RequestOpts::default(),
        )
        .await
    }

    /// `getblockheader/<hash>` (header fields only).
    pub async fn get_block_header(&self, hash: &str) -> Result<DaemonBlock> {
        self.get(
            "getblockheader",
            &format!("daemon/getblockheader/{}", seg(hash)),
            &RequestOpts::default(),
        )
        .await
    }

    /// `getblockdeltas/<hash>`: input addresses and values for a whole block.
    pub async fn get_block_deltas(&self, hash: &str) -> Result<BlockDeltas> {
        self.get(
            "getblockdeltas",
            &format!("daemon/getblockdeltas/{}", seg(hash)),
            &RequestOpts::default(),
        )
        .await
    }

    /// `getblockcount` (30 s apicache: not for liveness).
    pub async fn get_block_count(&self) -> Result<u32> {
        self.get(
            "getblockcount",
            "daemon/getblockcount",
            &RequestOpts::default(),
        )
        .await
    }

    /// `getbestblockhash` (cached: not for liveness).
    pub async fn get_best_block_hash(&self) -> Result<Hash32> {
        let s: String = self
            .get(
                "getbestblockhash",
                "daemon/getbestblockhash",
                &RequestOpts::default(),
            )
            .await?;
        Hash32::from_hex(&s).map_err(|e| FluxError::Parse {
            what: "getbestblockhash",
            message: e.to_string(),
        })
    }

    /// `getblockhash/<height>`. Returns `Ok(None)` when the height is beyond the tip (daemon
    /// error -8, never cached upstream). With `cache_bust`, this is the fallback tip detector.
    pub async fn get_block_hash(&self, height: u32, cache_bust: bool) -> Result<Option<Hash32>> {
        let mut opts = RequestOpts::default().attempts(1);
        opts.cache_bust = cache_bust;
        match self
            .get::<String>(
                "getblockhash",
                &format!("daemon/getblockhash/{height}"),
                &opts,
            )
            .await
        {
            Ok(s) => Hash32::from_hex(&s)
                .map(Some)
                .map_err(|e| FluxError::Parse {
                    what: "getblockhash",
                    message: e.to_string(),
                }),
            Err(FluxError::Upstream { code: Some(-8), .. }) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// `gettxoutsetinfo` (about 3 s upstream; cache for 10 min).
    pub async fn get_txout_set_info(&self) -> Result<TxOutSetInfo> {
        self.get(
            "gettxoutsetinfo",
            "daemon/gettxoutsetinfo",
            &RequestOpts::default().timeout(Duration::from_secs(30)),
        )
        .await
    }

    pub async fn get_blockchain_info(&self) -> Result<BlockchainInfo> {
        self.get(
            "getblockchaininfo",
            "daemon/getblockchaininfo",
            &RequestOpts::default(),
        )
        .await
    }

    pub async fn get_info(&self) -> Result<DaemonInfo> {
        self.get("getinfo", "daemon/getinfo", &RequestOpts::default())
            .await
    }

    pub async fn get_raw_transaction(&self, txid: &Hash32) -> Result<DaemonTx> {
        self.get(
            "getrawtransaction",
            &format!("daemon/getrawtransaction/{txid}/1"),
            &RequestOpts::default(),
        )
        .await
    }

    /// `getrawmempool/true` past the gateway's 30 s apicache (`?nc=`): the cached answer lists
    /// transactions of the previous block, mined by the time it is served. The daemon's own
    /// 20 s RPC cache still applies.
    pub async fn get_raw_mempool_fresh(&self) -> Result<RawMempool> {
        self.get(
            "getrawmempool",
            "daemon/getrawmempool/true",
            &RequestOpts::default().cache_bust(),
        )
        .await
    }

    pub async fn get_raw_mempool(&self) -> Result<RawMempool> {
        self.get(
            "getrawmempool",
            "daemon/getrawmempool/true",
            &RequestOpts::default(),
        )
        .await
    }

    pub async fn get_mempool_info(&self) -> Result<MempoolInfo> {
        self.get(
            "getmempoolinfo",
            "daemon/getmempoolinfo",
            &RequestOpts::default(),
        )
        .await
    }

    // ----- daemon: fluxnodes -----

    /// `fluxnodecurrentwinner`, cache-busted (it names the payees of the next block).
    pub async fn fluxnode_current_winner(&self) -> Result<CurrentWinners> {
        self.get(
            "fluxnodecurrentwinner",
            "daemon/fluxnodecurrentwinner",
            &RequestOpts::default().cache_bust(),
        )
        .await
    }

    pub async fn get_fluxnode_count(&self) -> Result<FluxnodeCount> {
        self.get(
            "getfluxnodecount",
            "daemon/getfluxnodecount",
            &RequestOpts::default(),
        )
        .await
    }

    /// Full deterministic node list, or a substring-filtered subset (collateral txid, IP, or
    /// payment address).
    pub async fn node_list(&self, filter: Option<&str>) -> Result<Vec<NodeListEntry>> {
        match filter {
            None => {
                self.get(
                    "viewdeterministicfluxnodelist",
                    "daemon/viewdeterministicfluxnodelist",
                    &big(),
                )
                .await
            }
            Some(f) => {
                self.get(
                    "viewdeterministicfluxnodelist",
                    &format!("daemon/viewdeterministicfluxnodelist/{}", seg(f)),
                    &RequestOpts::default(),
                )
                .await
            }
        }
    }

    /// Started, not yet confirmed nodes.
    pub async fn start_list(&self) -> Result<Vec<PendingNodeEntry>> {
        self.get(
            "getstartlist",
            "daemon/getstartlist",
            &RequestOpts::default(),
        )
        .await
    }

    /// [`Self::start_list`] past the gateway's apicache (`?nc=`), for the poll right after a
    /// block with new starts (the daemon's own 20 s cache still applies).
    pub async fn start_list_fresh(&self) -> Result<Vec<PendingNodeEntry>> {
        let opts = RequestOpts {
            cache_bust: true,
            ..RequestOpts::default()
        };
        self.get("getstartlist", "daemon/getstartlist", &opts).await
    }

    /// Nodes banned for failing to confirm.
    pub async fn dos_list(&self) -> Result<Vec<PendingNodeEntry>> {
        self.get("getdoslist", "daemon/getdoslist", &RequestOpts::default())
            .await
    }

    // ----- apps -----

    /// All app specs; pass the previous ETag to get [`Conditional::NotModified`] cheaply.
    pub async fn global_app_specs(
        &self,
        etag: Option<&str>,
    ) -> Result<Conditional<Vec<RawAppSpec>>> {
        let mut opts = big();
        opts.if_none_match = etag.map(str::to_owned);
        self.get_conditional(
            "globalappsspecifications",
            "apps/globalappsspecifications",
            &opts,
        )
        .await
    }

    pub async fn app_specification(&self, name: &str) -> Result<RawAppSpec> {
        self.get(
            "appspecifications",
            &format!("apps/appspecifications/{}", seg(name)),
            &RequestOpts::default(),
        )
        .await
    }

    /// Every running instance (`(name, ip)` rows, re-broadcast hourly, expire after 125 min).
    pub async fn app_locations(&self) -> Result<Vec<AppLocation>> {
        self.get("locations", "apps/locations", &big()).await
    }

    /// Instances of one app (hot-app polling).
    pub async fn app_location(&self, name: &str) -> Result<Vec<AppLocation>> {
        self.get(
            "location",
            &format!("apps/location/{}", seg(name)),
            &RequestOpts::default(),
        )
        .await
    }

    /// Permanent (mined) app messages.
    pub async fn permanent_messages(
        &self,
        filter: MessageFilter<'_>,
    ) -> Result<Vec<PermanentMessage>> {
        let (path, opts) = match filter {
            MessageFilter::All => (
                "apps/permanentmessages".to_owned(),
                RequestOpts::default()
                    .timeout(Duration::from_secs(180))
                    .max_bytes(HUGE_BODY)
                    .attempts(2),
            ),
            MessageFilter::Hash(h) => (
                format!("apps/permanentmessages?hash={h}"),
                RequestOpts::default(),
            ),
            MessageFilter::AppName(n) => (
                format!("apps/permanentmessages?appname={}", seg(n)),
                RequestOpts::default(),
            ),
            MessageFilter::Owner(o) => (
                format!("apps/permanentmessages?owner={}", seg(o)),
                RequestOpts::default(),
            ),
        };
        self.get("permanentmessages", &path, &opts).await
    }

    /// Broadcast but not yet mined app messages (5 s apicache).
    pub async fn temporary_messages(&self) -> Result<Vec<TemporaryMessage>> {
        self.get(
            "temporarymessages",
            "apps/temporarymessages",
            &RequestOpts::default(),
        )
        .await
    }

    pub async fn installing_locations(&self) -> Result<Vec<InstallingLocation>> {
        self.get(
            "installinglocations",
            "apps/installinglocations",
            &RequestOpts::default(),
        )
        .await
    }

    pub async fn installing_error_locations(&self) -> Result<Vec<InstallingError>> {
        self.get(
            "installingerrorslocations",
            "apps/installingerrorslocations",
            &big(),
        )
        .await
    }

    pub async fn deployment_information(&self) -> Result<DeploymentInformation> {
        self.get(
            "deploymentinformation",
            "apps/deploymentinformation",
            &RequestOpts::default(),
        )
        .await
    }
}

/// Insight explorer client with mirror failover.
#[derive(Clone, Debug)]
pub struct InsightClient {
    http: HttpClient,
    set: Arc<FailoverSet>,
}

impl InsightClient {
    pub fn new(http: HttpClient, bases: &[&str]) -> Result<Self> {
        Ok(Self {
            http,
            set: Arc::new(FailoverSet::new("insight", bases)?),
        })
    }

    pub fn failover(&self) -> &FailoverSet {
        &self.set
    }

    /// GET `/api/<path>` through the mirror set and parse plain JSON.
    pub async fn get<T: DeserializeOwned>(
        &self,
        what: &'static str,
        path: &str,
        opts: &RequestOpts,
    ) -> Result<T> {
        let path = format!("api/{}", path.trim_start_matches('/'));
        let path = path.as_str();
        self.set
            .run(|u| async move {
                let b = self.http.get_body(&join(&u.base, path)?, opts).await?;
                Ok((parse_plain::<T>(what, &b.bytes)?, b.elapsed))
            })
            .await
    }

    /// `block/<hash>` (hash only). Carries `nodesCollateral` (full producer txid).
    pub async fn block(&self, hash: &Hash32) -> Result<InsightBlock> {
        self.get(
            "insight block",
            &format!("block/{hash}"),
            &RequestOpts::default(),
        )
        .await
    }

    /// `block-index/<height>` to hash.
    pub async fn block_hash(&self, height: u32) -> Result<Hash32> {
        let v: crate::models::insight::BlockIndex = self
            .get(
                "insight block-index",
                &format!("block-index/{height}"),
                &RequestOpts::default(),
            )
            .await?;
        Hash32::from_hex(&v.block_hash).map_err(|e| FluxError::Parse {
            what: "insight block-index",
            message: e.to_string(),
        })
    }

    /// Latest blocks (`limit`), or blocks of a UTC date `YYYY-MM-DD`.
    pub async fn blocks(&self, limit: u32, date: Option<&str>) -> Result<InsightBlocksPage> {
        let path = match date {
            Some(d) => format!("blocks?limit={limit}&blockDate={}", seg(d)),
            None => format!("blocks?limit={limit}"),
        };
        self.get("insight blocks", &path, &RequestOpts::default())
            .await
    }

    pub async fn tx(&self, txid: &Hash32) -> Result<InsightTx> {
        self.get("insight tx", &format!("tx/{txid}"), &RequestOpts::default())
            .await
    }

    /// Transactions of a block, 10 per page.
    pub async fn block_txs(&self, hash: &Hash32, page: u32) -> Result<InsightTxsPage> {
        self.get(
            "insight txs",
            &format!("txs?block={hash}&pageNum={page}"),
            &RequestOpts::default(),
        )
        .await
    }

    /// Address summary without the tx list (a cold large address can take about 5 s).
    pub async fn address(&self, addr: &str) -> Result<InsightAddrSummary> {
        self.get(
            "insight addr",
            &format!("addr/{}?noTxList=1", seg(addr)),
            &RequestOpts::default().timeout(Duration::from_secs(30)),
        )
        .await
    }

    /// Address transactions, newest first, items `from..to`.
    pub async fn address_txs(&self, addr: &str, from: u32, to: u32) -> Result<InsightAddrTxs> {
        self.get(
            "insight addrs txs",
            &format!("addrs/{}/txs?from={from}&to={to}", seg(addr)),
            &RequestOpts::default(),
        )
        .await
    }

    pub async fn utxos(&self, addr: &str) -> Result<Vec<InsightUtxo>> {
        self.get("insight utxo", &format!("addr/{}/utxo", seg(addr)), &big())
            .await
    }

    /// Top 1000 addresses.
    pub async fn richest(&self) -> Result<Vec<RichListRow>> {
        self.get(
            "insight richest",
            "statistics/richest-addresses-list",
            &RequestOpts::default(),
        )
        .await
    }

    /// Daily series: `kind` in `supply`, `transactions`, `fees`, `outputs`, `difficulty`,
    /// `network-hash`; `days` in 30, 60, 180, 365, 730, or `all`.
    pub async fn stats_series(&self, kind: &str, days: &str) -> Result<Vec<StatPoint>> {
        self.get(
            "insight statistics",
            &format!("statistics/{}?days={}", seg(kind), seg(days)),
            &RequestOpts::default().timeout(BIG_TIMEOUT),
        )
        .await
    }

    pub async fn circulating_supply(&self) -> Result<CirculatingSupply> {
        self.get(
            "insight circulating-supply",
            "statistics/circulating-supply?format=object",
            &RequestOpts::default(),
        )
        .await
    }

    pub async fn markets_info(&self) -> Result<MarketsInfo> {
        self.get("insight markets", "markets/info", &RequestOpts::default())
            .await
    }

    pub async fn status_info(&self) -> Result<InsightStatusInfo> {
        self.get(
            "insight status",
            "status?q=getInfo",
            &RequestOpts::default(),
        )
        .await
    }

    /// Tip hash (fallback poll while no socket is healthy).
    pub async fn last_block_hash(&self) -> Result<LastBlockHash> {
        self.get(
            "insight lastblockhash",
            "status?q=getLastBlockHash",
            &RequestOpts::default().attempts(1),
        )
        .await
    }

    pub async fn sync(&self) -> Result<InsightSync> {
        self.get("insight sync", "sync", &RequestOpts::default())
            .await
    }
}

/// stats.runonflux.io client.
#[derive(Clone, Debug)]
pub struct StatsClient {
    http: HttpClient,
    set: Arc<FailoverSet>,
}

impl StatsClient {
    pub fn new(http: HttpClient, base: &str) -> Result<Self> {
        Ok(Self {
            http,
            set: Arc::new(FailoverSet::new("stats", &[base])?),
        })
    }

    async fn get<T: DeserializeOwned>(
        &self,
        what: &'static str,
        path: &str,
        opts: &RequestOpts,
    ) -> Result<T> {
        self.set
            .run(|u| async move {
                let b = self.http.get_body(&join(&u.base, path)?, opts).await?;
                Ok((parse_envelope::<T>(what, &b.bytes)?, b.elapsed))
            })
            .await
    }

    /// `/fluxinfo[?projection=a,b.c]`: one row per node for the current round.
    pub async fn fluxinfo(&self, projection: Option<&[&str]>) -> Result<Vec<StatsNodeRow>> {
        let path = match projection {
            Some(fields) => format!(
                "fluxinfo?projection={}",
                fields.iter().map(|f| seg(f)).collect::<Vec<_>>().join(",")
            ),
            None => "fluxinfo".to_owned(),
        };
        self.get("fluxinfo", &path, &big()).await
    }

    /// Cheap round-change probe: only `roundTime` of every row.
    pub async fn fluxinfo_round(&self) -> Result<Option<u64>> {
        let rows = self.fluxinfo(Some(&["roundTime"])).await?;
        Ok(rows.iter().filter_map(|r| r.round_time).max())
    }

    /// Per-IP geolocation (works for unreachable nodes).
    pub async fn fluxlocation(&self, ip: std::net::IpAddr) -> Result<FluxLocation> {
        self.get(
            "fluxlocation",
            &format!("fluxlocation/{ip}"),
            &RequestOpts::default(),
        )
        .await
    }

    /// 30 days of tier counts at about 15-minute resolution.
    pub async fn history_stats(&self) -> Result<HistoryStats> {
        self.get("fluxhistorystats", "fluxhistorystats", &big())
            .await
    }

    pub async fn marketplace_apps(&self) -> Result<Vec<MarketplaceApp>> {
        self.get(
            "marketplace",
            "marketplace/listapps",
            &RequestOpts::default(),
        )
        .await
    }
}

/// Direct per-node FluxOS API. Every call takes a [`GuardedEndpoint`], so the SSRF guard is
/// always applied, and requests are rate limited per IP with a 4 MB response cap.
#[derive(Clone, Debug)]
pub struct NodeApiClient {
    http: HttpClient,
    timeout: Duration,
}

impl NodeApiClient {
    pub fn new(http: HttpClient) -> Self {
        Self {
            http,
            timeout: Duration::from_secs(6),
        }
    }

    pub fn with_timeout(mut self, d: Duration) -> Self {
        self.timeout = d;
        self
    }

    fn opts(&self) -> RequestOpts {
        RequestOpts::default().timeout(self.timeout).attempts(1)
    }

    async fn get<T: DeserializeOwned>(
        &self,
        ep: &GuardedEndpoint,
        what: &'static str,
        path: &str,
    ) -> Result<T> {
        let b = self.http.get_node(ep, path, &self.opts()).await?;
        parse_envelope(what, &b.bytes)
    }

    pub async fn flux_info(&self, ep: &GuardedEndpoint) -> Result<FluxInfo> {
        self.get(ep, "flux/info", "flux/info").await
    }

    /// Cheap liveness probe (WatchProbe).
    pub async fn version(&self, ep: &GuardedEndpoint) -> Result<String> {
        self.get(ep, "flux/version", "flux/version").await
    }

    pub async fn uptime(&self, ep: &GuardedEndpoint) -> Result<u64> {
        let v: Option<f64> = self.get(ep, "flux/uptime", "flux/uptime").await?;
        Ok(v.map_or(0, |x| x.max(0.0) as u64))
    }

    pub async fn is_arcane_os(&self, ep: &GuardedEndpoint) -> Result<bool> {
        self.get(ep, "flux/isarcaneos", "flux/isarcaneos").await
    }

    /// Outgoing peers as bare IPs (deprecated upstream; no ports).
    pub async fn connected_peers(&self, ep: &GuardedEndpoint) -> Result<Vec<String>> {
        self.get(ep, "flux/connectedpeers", "flux/connectedpeers")
            .await
    }

    /// Incoming peers as bare IPs (deprecated upstream; no ports).
    pub async fn incoming_connections(&self, ep: &GuardedEndpoint) -> Result<Vec<String>> {
        self.get(ep, "flux/incomingconnections", "flux/incomingconnections")
            .await
    }

    pub async fn connected_peers_info(
        &self,
        ep: &GuardedEndpoint,
    ) -> Result<Vec<ConnectedPeerInfo>> {
        self.get(ep, "flux/connectedpeersinfo", "flux/connectedpeersinfo")
            .await
    }

    /// Rich per-link stats (FluxOS 8.x).
    pub async fn peers(&self, ep: &GuardedEndpoint) -> Result<Vec<PeerLink>> {
        self.get(ep, "flux/peers", "flux/peers").await
    }

    /// Peer lists that about 60 neighbours reported (TopologySweep).
    pub async fn topology(&self, ep: &GuardedEndpoint) -> Result<Topology> {
        self.get(ep, "flux/topology", "flux/topology").await
    }

    pub async fn benchmarks(&self, ep: &GuardedEndpoint) -> Result<Bench> {
        self.get(ep, "benchmark/getbenchmarks", "benchmark/getbenchmarks")
            .await
    }

    pub async fn installed_apps(&self, ep: &GuardedEndpoint) -> Result<Vec<RawAppSpec>> {
        self.get(ep, "apps/installedapps", "apps/installedapps")
            .await
    }

    pub async fn running_apps(&self, ep: &GuardedEndpoint) -> Result<Vec<RunningContainer>> {
        self.get(ep, "apps/listrunningapps", "apps/listrunningapps")
            .await
    }

    pub async fn geolocation(&self, ep: &GuardedEndpoint) -> Result<Geolocation> {
        self.get(ep, "flux/geolocation", "flux/geolocation").await
    }

    pub async fn health(&self, ep: &GuardedEndpoint) -> Result<HealthReport> {
        self.get(ep, "flux/health", "flux/health").await
    }

    /// The node's daemon height (used to reject stale failover nodes).
    pub async fn block_count(&self, ep: &GuardedEndpoint) -> Result<u32> {
        self.get(ep, "getblockcount", "daemon/getblockcount").await
    }
}

/// CoinGecko price fallback (at most once per 60 s).
#[derive(Clone, Debug)]
pub struct CoinGeckoClient {
    http: HttpClient,
    base: Url,
}

impl CoinGeckoClient {
    pub fn new(http: HttpClient, base: &str) -> Result<Self> {
        Ok(Self {
            http,
            base: Url::parse(base).map_err(|e| FluxError::BadUrl(e.to_string()))?,
        })
    }

    /// `simple/price?ids=zelcash` in USD and BTC with 24 h change, market cap and volume.
    pub async fn simple_price(&self) -> Result<CoinGeckoSimplePrice> {
        let url = join(
            &self.base,
            "api/v3/simple/price?ids=zelcash&vs_currencies=usd,btc&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true",
        )?;
        let b = self.http.get_body(&url, &RequestOpts::default()).await?;
        parse_plain("coingecko simple price", &b.bytes)
    }
}

/// Endpoint configuration for [`Clients`].
#[derive(Debug, Clone)]
pub struct ClientsConfig {
    pub http: HttpConfig,
    pub fluxos_gateway: String,
    pub insight_bases: Vec<String>,
    pub stats_base: String,
    pub coingecko_base: String,
}

impl Default for ClientsConfig {
    fn default() -> Self {
        Self {
            http: HttpConfig::default(),
            fluxos_gateway: FLUXOS_GATEWAY.to_owned(),
            insight_bases: INSIGHT_BASES.iter().map(|s| (*s).to_owned()).collect(),
            stats_base: STATS_BASE.to_owned(),
            coingecko_base: COINGECKO_BASE.to_owned(),
        }
    }
}

/// All upstream clients, sharing one connection pool and rate-limit state. Cheap to clone.
#[derive(Clone, Debug)]
pub struct Clients {
    pub http: HttpClient,
    pub fluxos: FluxOsClient,
    pub insight: InsightClient,
    pub stats: StatsClient,
    pub node_api: NodeApiClient,
    pub coingecko: CoinGeckoClient,
}

impl Clients {
    pub fn new(cfg: ClientsConfig) -> Result<Self> {
        let http = HttpClient::new(cfg.http)?;
        let insight_bases: Vec<&str> = cfg.insight_bases.iter().map(String::as_str).collect();
        Ok(Self {
            fluxos: FluxOsClient::new(http.clone(), &cfg.fluxos_gateway)?,
            insight: InsightClient::new(http.clone(), &insight_bases)?,
            stats: StatsClient::new(http.clone(), &cfg.stats_base)?,
            node_api: NodeApiClient::new(http.clone()),
            coingecko: CoinGeckoClient::new(http.clone(), &cfg.coingecko_base)?,
            http,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_are_escaped() {
        assert_eq!(seg("abc"), "abc");
        assert_eq!(seg("a/b?c"), "a%2Fb%3Fc");
        assert_eq!(seg("North Carolina"), "North%20Carolina");
    }

    #[test]
    fn clients_build() {
        let c = Clients::new(ClientsConfig::default()).unwrap();
        assert_eq!(c.insight.failover().primaries().len(), 3);
        assert_eq!(c.fluxos.failover().primaries().len(), 1);
    }
}
