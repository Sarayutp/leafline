import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArchiveRestore,
  Bookmark,
  BookmarkCheck,
  Check,
  CheckCheck,
  ChevronDown,
  Circle,
  Clock3,
  ExternalLink,
  Inbox,
  Leaf,
  LoaderCircle,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
  Type,
  Unplug,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, ApiError } from "./api";
import { loadSnapshot, saveSnapshot } from "./cache";
import { canStartSwipe, resolveSwipe, type SwipeStart } from "./gestures";
import { READER_FONT_SIZE_MAX, READER_FONT_SIZE_MIN, readerFontSizeFromStorage } from "./preferences";
import type { Article, ArticleContent, ArticleReadFilter, Feed, LibraryView } from "./types";
import { feedColor, fullDate, initials, relativeDate } from "./utils";

type Stage = "checking" | "onboarding" | "ready" | "failed";

const DEFAULT_VIEW: LibraryView = { kind: "inbox", label: "ข่าวทั้งหมด" };

function App() {
  const [stage, setStage] = useState<Stage>("checking");
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [view, setView] = useState<LibraryView>(DEFAULT_VIEW);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [readFilter, setReadFilter] = useState<ArticleReadFilter>(() => {
    const saved = localStorage.getItem("leafline.readFilter");
    if (saved === "read" || saved === "unread") return saved;
    return localStorage.getItem("leafline.hideRead") === "true" ? "unread" : "all";
  });
  const [feedArticles, setFeedArticles] = useState<Article[]>([]);
  const [feedCursor, setFeedCursor] = useState<string | null>(null);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [dark, setDark] = useState(() => localStorage.getItem("leafline.theme") === "dark");
  const [readerFontSize, setReaderFontSize] = useState(() => readerFontSizeFromStorage(localStorage.getItem("leafline.readerFontSize")));

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const loadLibrary = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [nextFeeds, nextArticles] = await Promise.all([api.feeds(), api.articles()]);
      setFeeds(nextFeeds);
      setArticles(nextArticles);
      setLastSynced(new Date());
      setStage("ready");
      void saveSnapshot(nextFeeds, nextArticles);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        api.disconnect();
        setStage("onboarding");
      } else if (!silent) {
        const cached = await loadSnapshot().catch(() => null);
        if (cached) {
          setFeeds(cached.feeds);
          setArticles(cached.articles);
          setLastSynced(new Date(cached.savedAt));
          setStage("ready");
          notify("ออฟไลน์อยู่ — กำลังแสดงข้อมูลที่ซิงก์ล่าสุด");
        } else {
          setStage("failed");
        }
      }
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    api.consumePairingLink();
    const boot = async () => {
      if (!api.apiUrl || !api.token) {
        setStage("onboarding");
        return;
      }
      await loadLibrary();
    };
    void boot();
  }, [loadLibrary]);

  useEffect(() => {
    if (stage !== "ready") return;
    const timer = window.setInterval(() => void loadLibrary(true), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadLibrary(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadLibrary, stage]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("leafline.theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    document.documentElement.style.setProperty("--reader-font-size", `${readerFontSize}px`);
    localStorage.setItem("leafline.readerFontSize", String(readerFontSize));
  }, [readerFontSize]);

  useEffect(() => {
    localStorage.setItem("leafline.readFilter", readFilter);
    localStorage.setItem("leafline.hideRead", String(readFilter === "unread"));
  }, [readFilter]);

  useEffect(() => {
    if (stage !== "ready" || view.kind !== "feed") {
      setFeedArticles([]);
      setFeedCursor(null);
      setFeedHasMore(false);
      setFeedLoading(false);
      return;
    }

    let current = true;
    setFeedArticles([]);
    setFeedCursor(null);
    setFeedHasMore(false);
    setFeedLoading(true);
    void api.articlePage({ feedId: view.id, read: readFilter, limit: 50 })
      .then((page) => {
        if (!current) return;
        setFeedArticles(page.articles);
        setFeedCursor(page.nextCursor);
        setFeedHasMore(page.hasMore);
      })
      .catch(() => {
        if (current) notify("โหลดคลังข่าวของแหล่งนี้ไม่สำเร็จ");
      })
      .finally(() => {
        if (current) setFeedLoading(false);
      });
    return () => {
      current = false;
    };
  }, [notify, readFilter, stage, view]);

  const loadMoreFeed = async () => {
    if (view.kind !== "feed" || !feedCursor || feedLoading) return;
    setFeedLoading(true);
    try {
      const page = await api.articlePage({ feedId: view.id, read: readFilter, limit: 50, cursor: feedCursor });
      setFeedArticles((current) => {
        const existing = new Set(current.map((article) => article.id));
        return [...current, ...page.articles.filter((article) => !existing.has(article.id))];
      });
      setFeedCursor(page.nextCursor);
      setFeedHasMore(page.hasMore);
    } catch {
      notify("โหลดข่าวย้อนหลังเพิ่มไม่สำเร็จ");
    } finally {
      setFeedLoading(false);
    }
  };

  const activeArticles = view.kind === "feed" ? feedArticles : articles;

  const selected = useMemo(
    () => feedArticles.find((article) => article.id === selectedId) || articles.find((article) => article.id === selectedId) || null,
    [articles, feedArticles, selectedId],
  );

  const visibleArticles = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const query = search.trim().toLocaleLowerCase("th");

    return activeArticles.filter((article) => {
      if (view.kind === "today" && new Date(article.publishedAt || article.fetchedAt) < today) return false;
      if (view.kind === "starred" && !article.isStarred) return false;
      if (view.kind === "category" && article.feedCategory !== view.id) return false;
      if (view.kind === "feed" && article.feedId !== view.id) return false;
      if (readFilter === "unread" && article.isRead && article.id !== selectedId) return false;
      if (readFilter === "read" && !article.isRead && article.id !== selectedId) return false;
      if (query && !`${article.title} ${article.summary} ${article.feedTitle}`.toLocaleLowerCase("th").includes(query)) {
        return false;
      }
      return true;
    });
  }, [activeArticles, readFilter, search, selectedId, view]);

  const selectedVisibleIndex = selectedId
    ? visibleArticles.findIndex((article) => article.id === selectedId)
    : -1;
  const nextArticle = visibleArticles[selectedVisibleIndex + 1] || null;
  const previousArticle = selectedVisibleIndex > 0 ? visibleArticles[selectedVisibleIndex - 1] : null;

  const chooseArticle = (article: Article) => {
    setSelectedId(article.id);
    setReaderOpen(true);
    if (!article.isRead) void changeArticleState(article.id, { isRead: true });
  };

  const changeArticleState = async (articleId: string, patch: { isRead?: boolean; isStarred?: boolean }) => {
    const previous = articles;
    const previousFeedArticles = feedArticles;
    setArticles((current) =>
      current.map((article) => (article.id === articleId ? { ...article, ...patch } : article)),
    );
    setFeedArticles((current) =>
      current.map((article) => (article.id === articleId ? { ...article, ...patch } : article)),
    );
    try {
      await api.updateState(articleId, patch);
    } catch {
      setArticles(previous);
      setFeedArticles(previousFeedArticles);
      notify("ซิงก์ไม่สำเร็จ กรุณาลองอีกครั้ง");
    }
  };

  const markVisibleRead = async () => {
    const ids = visibleArticles.filter((article) => !article.isRead).map((article) => article.id);
    if (!ids.length) return;
    setArticles((current) => current.map((article) => (ids.includes(article.id) ? { ...article, isRead: true } : article)));
    setFeedArticles((current) => current.map((article) => (ids.includes(article.id) ? { ...article, isRead: true } : article)));
    try {
      await api.bulkRead(ids);
      notify(`ทำเครื่องหมายอ่านแล้ว ${ids.length} ข่าว`);
    } catch {
      await loadLibrary(true);
      notify("ซิงก์ไม่สำเร็จ กรุณาลองอีกครั้ง");
    }
  };

  const selectView = (next: LibraryView) => {
    setView(next);
    setSelectedId(null);
    setSidebarOpen(false);
    setReaderOpen(false);
  };

  const updateLoadedContent = useCallback((articleId: string, content: ArticleContent) => {
    setArticles((current) => current.map((article) => (
      article.id === articleId
        ? { ...article, hasContent: Boolean(content.contentHtml), imageUrl: content.imageUrl || article.imageUrl }
        : article
    )));
  }, []);

  useEffect(() => {
    if (stage !== "ready" || addOpen || settingsOpen) return;

    const openNextArticle = (event: KeyboardEvent) => {
      if (
        (event.key !== "ArrowDown" && event.key !== "ArrowRight") ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (!nextArticle) return;

      event.preventDefault();
      chooseArticle(nextArticle);
    };

    window.addEventListener("keydown", openNextArticle);
    return () => window.removeEventListener("keydown", openNextArticle);
  }, [addOpen, nextArticle, settingsOpen, stage]);

  if (stage === "checking") return <Splash />;
  if (stage === "onboarding") return <Onboarding onConnected={() => void loadLibrary()} dark={dark} setDark={setDark} />;
  if (stage === "failed") {
    return (
      <ErrorScreen
        onRetry={() => void loadLibrary()}
        onReconnect={() => {
          api.disconnect();
          setStage("onboarding");
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        feeds={feeds}
        articles={articles}
        view={view}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={selectView}
        onAdd={() => setAddOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="feed-column">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="เปิดเมนู">
            <Menu size={20} />
          </button>
          <div className="topbar-title">
            <span className="eyebrow">LIBRARY</span>
            <h1>{view.label}</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => setDark((value) => !value)} aria-label="สลับธีม">
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
          </div>
        </header>

        <div className="article-filter" role="group" aria-label="กรองสถานะการอ่าน">
          <button className={readFilter === "all" ? "active" : ""} onClick={() => setReadFilter("all")}>ทั้งหมด</button>
          <button className={readFilter === "unread" ? "active" : ""} onClick={() => setReadFilter("unread")}><Circle size={14} />ยังไม่อ่าน</button>
          <button className={readFilter === "read" ? "active" : ""} onClick={() => setReadFilter("read")}><Check size={14} />อ่านแล้ว</button>
        </div>

        <div className="search-row">
          <div className="search-box">
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาในข่าวของคุณ" />
            {search && (
              <button onClick={() => setSearch("")} aria-label="ล้างการค้นหา">
                <X size={16} />
              </button>
            )}
          </div>
          <button className="icon-button" onClick={() => void loadLibrary()} disabled={loading} aria-label="ซิงก์ข้อมูล">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
          <button className="icon-button" onClick={() => void markVisibleRead()} aria-label="อ่านทั้งหมดแล้ว">
            <CheckCheck size={19} />
          </button>
        </div>

        <div className="list-meta">
          <span>{visibleArticles.length} เรื่อง{view.kind === "feed" && feedHasMore ? " · ยังมีอีก" : ""}</span>
          <span className="sync-status"><span className="online-dot" /> ซิงก์แล้ว {lastSynced ? relativeDate(lastSynced.toISOString()) : ""}</span>
        </div>

        <section className="article-list" aria-label="รายการข่าว">
          {visibleArticles.length ? (
            <>
              {visibleArticles.map((article) => (
                <ArticleRow
                  key={article.id}
                  article={article}
                  selected={article.id === selectedId}
                  onSelect={() => chooseArticle(article)}
                  onStar={() => void changeArticleState(article.id, { isStarred: !article.isStarred })}
                />
              ))}
              {view.kind === "feed" && feedHasMore && (
                <button className="load-more-button" onClick={() => void loadMoreFeed()} disabled={feedLoading}>
                  {feedLoading ? <LoaderCircle className="spin" size={17} /> : <ArchiveRestore size={17} />}
                  {feedLoading ? "กำลังโหลด…" : "โหลดข่าวย้อนหลังเพิ่มเติม"}
                </button>
              )}
            </>
          ) : feedLoading ? (
            <div className="feed-loading"><LoaderCircle className="spin" size={22} />กำลังโหลดคลังข่าว…</div>
          ) : (
            <EmptyList hasFeeds={feeds.length > 0} onAdd={() => setAddOpen(true)} />
          )}
        </section>
      </main>

      <Reader
        article={selected}
        open={readerOpen}
        hasNext={Boolean(selected && nextArticle)}
        hasPrevious={Boolean(selected && previousArticle)}
        onNext={() => nextArticle && chooseArticle(nextArticle)}
        onPrevious={() => previousArticle && chooseArticle(previousArticle)}
        onClose={() => setReaderOpen(false)}
        onToggleRead={() => selected && void changeArticleState(selected.id, { isRead: !selected.isRead })}
        onToggleStar={() => selected && void changeArticleState(selected.id, { isStarred: !selected.isStarred })}
        onContentLoaded={updateLoadedContent}
      />

      <nav className="mobile-nav">
        <button className={view.kind === "inbox" ? "active" : ""} onClick={() => selectView(DEFAULT_VIEW)}><Inbox size={20} /><span>ทั้งหมด</span></button>
        <button className={readFilter === "unread" ? "active" : ""} onClick={() => setReadFilter((current) => current === "unread" ? "all" : "unread")}><Circle size={20} /><span>ยังไม่อ่าน</span></button>
        <button className={view.kind === "starred" ? "active" : ""} onClick={() => selectView({ kind: "starred", label: "บันทึกไว้" })}><Bookmark size={20} /><span>บันทึก</span></button>
        <button onClick={() => setSettingsOpen(true)}><Settings size={20} /><span>ตั้งค่า</span></button>
      </nav>

      {addOpen && (
        <AddFeedModal
          categories={[...new Set(feeds.map((feed) => feed.category))]}
          onClose={() => setAddOpen(false)}
          onAdded={async (message) => {
            setAddOpen(false);
            notify(message);
            await loadLibrary();
          }}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          feeds={feeds}
          readerFontSize={readerFontSize}
          onReaderFontSizeChange={setReaderFontSize}
          onClose={() => setSettingsOpen(false)}
          onRefresh={async () => {
            const passes = Math.max(1, Math.ceil(feeds.length / 8));
            let succeeded = 0;
            let failed = 0;
            for (let pass = 0; pass < passes; pass += 1) {
              const result = await api.refreshFeeds(8);
              succeeded += result.succeeded;
              failed += result.failed;
            }
            notify(`ตรวจแล้ว ${succeeded + failed} แหล่ง · สำเร็จ ${succeeded}${failed ? ` · มีปัญหา ${failed}` : ""}`);
            await loadLibrary(true);
          }}
          onRefreshFeed={async (feedId) => {
            const result = await api.refreshFeed(feedId);
            notify(`อัปเดตแล้ว · พบ ${result.imported} ข่าวใน RSS`);
            await loadLibrary(true);
          }}
          onBackfill={async (feedId) => {
            const result = await api.backfillFeed(feedId, 5);
            notify(`นำเข้าข่าวย้อนหลัง ${result.completedPages} หน้า · ${result.imported} รายการ`);
            await loadLibrary(true);
          }}
          onDelete={async (feedId) => {
            await api.deleteFeed(feedId);
            await loadLibrary(true);
          }}
          onDisconnect={() => {
            api.disconnect();
            setSettingsOpen(false);
            setStage("onboarding");
          }}
        />
      )}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>
  );
}

function Splash() {
  return (
    <div className="splash">
      <div className="brand-mark"><Leaf size={28} /></div>
      <span>Leafline</span>
      <LoaderCircle className="spin muted" size={22} />
    </div>
  );
}

function Onboarding({ onConnected, dark, setDark }: { onConnected: () => void; dark: boolean; setDark: (value: boolean) => void }) {
  const [mode, setMode] = useState<"setup" | "pair">("setup");
  const [apiUrl, setApiUrl] = useState(api.apiUrl);
  const [secret, setSecret] = useState("");
  const [pairToken, setPairToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      api.configure(apiUrl, mode === "pair" ? pairToken : undefined);
      if (mode === "setup") await api.setup(secret);
      await api.verify();
      onConnected();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เชื่อมต่อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding">
      <button className="theme-float" onClick={() => setDark(!dark)} aria-label="สลับธีม">{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
      <section className="onboarding-copy">
        <div className="brand-lockup"><div className="brand-mark"><Leaf size={25} /></div><span>Leafline</span></div>
        <div className="hero-art" aria-hidden="true">
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <div className="paper-card card-one"><span /><span /><span /></div>
          <div className="paper-card card-two"><span /><span /><span /></div>
          <div className="hero-leaf"><Leaf size={70} /></div>
        </div>
        <span className="eyebrow">YOUR READING, IN SYNC</span>
        <h1>ข่าวที่คุณเลือก<br />สงบ เป็นส่วนตัว และตามคุณไปทุกเครื่อง</h1>
        <p>อ่านบน MacBook แล้วหยิบ iPhone ขึ้นมาอ่านต่อได้ทันที โดยไม่ต้องสร้างบัญชีหรือจำรหัสผ่านใหม่</p>
        <div className="feature-line"><Sparkles size={18} /><span>RSS ส่วนตัว · ซิงก์ 3 อุปกรณ์ · ไม่มีโฆษณา</span></div>
      </section>

      <form className="connection-card" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
        <div className="step-number">01</div>
        <span className="eyebrow">CONNECT YOUR READER</span>
        <h2>{mode === "setup" ? "ตั้งค่าเครื่องแรก" : "เชื่อมอุปกรณ์เครื่องนี้"}</h2>
        <p>{mode === "setup" ? "กรอก Worker URL และรหัสตั้งต้นที่สร้างตอน deploy" : "วางรหัสซิงก์ที่คัดลอกจากเครื่องหลัก"}</p>

        <div className="segmented">
          <button type="button" className={mode === "setup" ? "active" : ""} onClick={() => setMode("setup")}>เครื่องแรก</button>
          <button type="button" className={mode === "pair" ? "active" : ""} onClick={() => setMode("pair")}><Smartphone size={15} />เครื่องเพิ่มเติม</button>
        </div>

        <label className="field-label">
          Cloudflare Worker URL
          <input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} placeholder="https://leafline-api.your-name.workers.dev" inputMode="url" />
        </label>
        {mode === "setup" ? (
          <label className="field-label">
            Setup secret
            <input value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="รหัสที่ตั้งไว้ใน Cloudflare" type="password" />
          </label>
        ) : (
          <label className="field-label">
            Sync code
            <textarea value={pairToken} onChange={(event) => setPairToken(event.target.value)} placeholder="วางรหัสซิงก์จากเครื่องหลัก" rows={3} />
          </label>
        )}
        {error && <div className="inline-error">{error}</div>}
        <button type="submit" className="primary-button full" disabled={busy || !apiUrl || (mode === "setup" ? !secret : !pairToken)}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <Leaf size={18} />}
          {busy ? "กำลังเชื่อมต่อ…" : "เริ่มใช้ Leafline"}
        </button>
        <p className="privacy-note">รหัสซิงก์เก็บอยู่ในอุปกรณ์นี้เท่านั้น และไม่ถูกส่งไปยัง GitHub Pages</p>
      </form>
    </div>
  );
}

function ErrorScreen({ onRetry, onReconnect }: { onRetry: () => void; onReconnect: () => void }) {
  return (
    <div className="center-screen">
      <div className="empty-icon"><Unplug size={26} /></div>
      <h2>เชื่อมต่อ Leafline ไม่ได้</h2>
      <p>Worker อาจกำลังอัปเดต หรือการเชื่อมต่ออินเทอร์เน็ตมีปัญหา</p>
      <div className="button-row"><button className="primary-button" onClick={onRetry}><RefreshCw size={17} />ลองอีกครั้ง</button><button className="secondary-button" onClick={onReconnect}>ตั้งค่าการเชื่อมต่อ</button></div>
    </div>
  );
}

function Sidebar({ feeds, articles, view, open, onClose, onSelect, onAdd, onSettings }: {
  feeds: Feed[];
  articles: Article[];
  view: LibraryView;
  open: boolean;
  onClose: () => void;
  onSelect: (view: LibraryView) => void;
  onAdd: () => void;
  onSettings: () => void;
}) {
  const categories = [...new Set(feeds.map((feed) => feed.category))];
  const unread = articles.filter((article) => !article.isRead).length;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const today = articles.filter((article) => new Date(article.publishedAt || article.fetchedAt) >= todayStart).length;

  const countForCategory = (category: string) => articles.filter((article) => article.feedCategory === category && !article.isRead).length;

  return (
    <>
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="ปิดเมนู" />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand-lockup sidebar-brand"><div className="brand-mark"><Leaf size={21} /></div><span>Leafline</span><button className="icon-button mobile-only" onClick={onClose}><X size={19} /></button></div>
        <button className="add-feed-button" onClick={onAdd}><Plus size={17} />เพิ่มแหล่งข่าว</button>
        <nav className="sidebar-nav">
          <span className="nav-label">ภาพรวม</span>
          <SideItem active={view.kind === "inbox"} icon={<Inbox size={18} />} label="ข่าวทั้งหมด" count={unread} onClick={() => onSelect(DEFAULT_VIEW)} />
          <SideItem active={view.kind === "today"} icon={<Clock3 size={18} />} label="วันนี้" count={today} onClick={() => onSelect({ kind: "today", label: "ข่าววันนี้" })} />
          <SideItem active={view.kind === "starred"} icon={<Bookmark size={18} />} label="บันทึกไว้" onClick={() => onSelect({ kind: "starred", label: "บันทึกไว้" })} />

          {categories.length > 0 && <span className="nav-label nav-label-spaced">หมวดหมู่</span>}
          {categories.map((category) => (
            <div key={category} className="category-group">
              <SideItem
                active={view.kind === "category" && view.id === category}
                icon={<span className="folder-dot" />}
                label={category}
                count={countForCategory(category)}
                onClick={() => onSelect({ kind: "category", id: category, label: category })}
              />
              <div className="feed-sublist">
                {feeds.filter((feed) => feed.category === category).map((feed) => (
                  <button key={feed.id} className={view.kind === "feed" && view.id === feed.id ? "active" : ""} onClick={() => onSelect({ kind: "feed", id: feed.id, label: feed.title })}>
                    <span className="feed-mini-icon" style={{ background: feedColor(feed.title) }}>{initials(feed.title).slice(0, 1)}</span>
                    <span>{feed.title}</span>
                    {articles.filter((article) => article.feedId === feed.id && !article.isRead).length > 0 && (
                      <em>{articles.filter((article) => article.feedId === feed.id && !article.isRead).length}</em>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <button className="sidebar-settings" onClick={onSettings}><Settings size={18} />ตั้งค่าและอุปกรณ์<MoreHorizontal size={17} /></button>
      </aside>
    </>
  );
}

function SideItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button className={`side-item ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && count > 0 && <em>{count}</em>}</button>;
}

function ArticleRow({ article, selected, onSelect, onStar }: { article: Article; selected: boolean; onSelect: () => void; onStar: () => void }) {
  return (
    <article className={`article-row ${selected ? "selected" : ""} ${article.isRead ? "read" : ""}`} onClick={onSelect}>
      <div className="article-source">
        <span className="feed-avatar" style={{ background: feedColor(article.feedTitle) }}>{initials(article.feedTitle)}</span>
        <span>{article.feedTitle}</span>
        <i>·</i>
        <time>{relativeDate(article.publishedAt || article.fetchedAt)}</time>
        {!article.isRead && <span className="unread-dot" />}
      </div>
      <div className="article-row-body">
        <div>
          <h2>{article.title}</h2>
          <p>{article.summary || "เปิดอ่านรายละเอียดจากเว็บไซต์ต้นทาง"}</p>
        </div>
        {article.imageUrl && <img src={article.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
      </div>
      <button className={`star-button ${article.isStarred ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); onStar(); }} aria-label="บันทึกข่าว">
        {article.isStarred ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
      </button>
    </article>
  );
}

function Reader({ article, open, hasNext, hasPrevious, onNext, onPrevious, onClose, onToggleRead, onToggleStar, onContentLoaded }: {
  article: Article | null;
  open: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onContentLoaded: (articleId: string, content: ArticleContent) => void;
}) {
  const readerRef = useRef<HTMLElement>(null);
  const [content, setContent] = useState<ArticleContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState("");
  const [swipeMotion, setSwipeMotion] = useState<"next" | "previous" | null>(null);
  const swipeStartRef = useRef<SwipeStart | null>(null);

  useEffect(() => {
    readerRef.current?.scrollTo({ top: 0 });
    setContent(null);
    setContentError("");
    if (!article) {
      setContentLoading(false);
      return;
    }

    let current = true;
    setContentLoading(true);
    void api.articleContent(article.id)
      .then((result) => {
        if (!current) return;
        setContent(result);
        onContentLoaded(article.id, result);
      })
      .catch(() => {
        if (current) setContentError("ยังโหลดเนื้อหาเต็มไม่ได้ สามารถอ่านต่อจากเว็บไซต์ต้นฉบับ");
      })
      .finally(() => {
        if (current) setContentLoading(false);
      });

    return () => {
      current = false;
    };
  }, [article?.id, onContentLoaded]);

  useEffect(() => {
    if (!swipeMotion) return;
    const timer = window.setTimeout(() => setSwipeMotion(null), 260);
    return () => window.clearTimeout(timer);
  }, [article?.id, swipeMotion]);

  const beginSwipe = (event: React.PointerEvent<HTMLElement>) => {
    if (swipeMotion) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!canStartSwipe({
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      x: event.clientX,
      viewportWidth: window.innerWidth,
      interactiveTarget: Boolean(target?.closest('a, button, input, textarea, select, [contenteditable="true"]')),
    })) return;

    swipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedAt: Date.now(),
    };
  };

  const finishSwipe = (event: React.PointerEvent<HTMLElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;

    const direction = resolveSwipe(start, { x: event.clientX, y: event.clientY, endedAt: Date.now() });

    if (direction === "next" && hasNext) {
      setSwipeMotion("next");
      onNext();
    } else if (direction === "previous" && hasPrevious) {
      setSwipeMotion("previous");
      onPrevious();
    }
  };

  const fullContent = content?.contentHtml;
  const heroImage = content?.imageUrl || article?.imageUrl;

  return (
    <aside
      ref={readerRef}
      className={`reader ${open ? "open" : ""} ${swipeMotion ? `swipe-${swipeMotion}` : ""}`}
      aria-keyshortcuts="ArrowDown ArrowRight"
      onPointerDown={beginSwipe}
      onPointerUp={finishSwipe}
      onPointerCancel={() => { swipeStartRef.current = null; }}
    >
      {article ? (
        <>
          <div className="reader-toolbar">
            <button className="icon-button mobile-only" onClick={onClose}><ArrowLeft size={20} /></button>
            {hasNext && <span className="reader-shortcut-hint"><kbd>↓</kbd><kbd>→</kbd>ข่าวถัดไป</span>}
            <div className="reader-toolbar-spacer" />
            <button className={`icon-button ${article.isRead ? "active" : ""}`} onClick={onToggleRead} title={article.isRead ? "ทำเป็นยังไม่อ่าน" : "ทำเป็นอ่านแล้ว"}><CheckCheck size={19} /></button>
            <button className={`icon-button ${article.isStarred ? "active" : ""}`} onClick={onToggleStar} title="บันทึก"><Bookmark size={19} /></button>
            <a className="icon-button" href={article.url} target="_blank" rel="noreferrer" title="เปิดต้นฉบับ"><ExternalLink size={19} /></a>
          </div>
          {!fullContent && heroImage && <img className="reader-hero" src={heroImage} alt="" referrerPolicy="no-referrer" />}
          <div className="reader-content">
            <div className="reader-source"><span className="feed-avatar" style={{ background: feedColor(article.feedTitle) }}>{initials(article.feedTitle)}</span><div><strong>{article.feedTitle}</strong><span>{fullDate(article.publishedAt || article.fetchedAt)}</span></div></div>
            <h1>{article.title}</h1>
            {article.author && <p className="byline">โดย {article.author}</p>}
            {contentLoading && <div className="reader-content-loading"><LoaderCircle className="spin" size={17} />กำลังโหลดเนื้อหาเต็ม…</div>}
            {fullContent ? (
              <div className="reader-article-body" dangerouslySetInnerHTML={{ __html: fullContent }} />
            ) : (
              <p className="reader-summary">{article.summary || "ฟีดนี้ไม่มีเนื้อหาสรุป สามารถเปิดบทความต้นฉบับเพื่ออ่านต่อได้"}</p>
            )}
            {contentError && <p className="reader-content-error">{contentError}</p>}
            <a className="primary-button read-original" href={article.url} target="_blank" rel="noreferrer">อ่านบทความต้นฉบับ<ExternalLink size={17} /></a>
          </div>
        </>
      ) : (
        <div className="reader-placeholder"><div className="empty-icon"><Leaf size={28} /></div><h3>เลือกข่าวเพื่อเริ่มอ่าน</h3><p>สถานะอ่านแล้วจะซิงก์ไปทุกอุปกรณ์โดยอัตโนมัติ</p></div>
      )}
    </aside>
  );
}

function EmptyList({ hasFeeds, onAdd }: { hasFeeds: boolean; onAdd: () => void }) {
  return (
    <div className="empty-list">
      <div className="empty-icon"><Leaf size={27} /></div>
      <h3>{hasFeeds ? "อ่านครบแล้ว เรียบร้อยดี" : "เริ่มสร้างพื้นที่อ่านของคุณ"}</h3>
      <p>{hasFeeds ? "ไม่มีข่าวที่ตรงกับตัวกรองนี้" : "เพิ่ม RSS แรก แล้ว Leafline จะจัดข่าวทั้งหมดไว้ให้"}</p>
      {!hasFeeds && <button className="primary-button" onClick={onAdd}><Plus size={17} />เพิ่มแหล่งข่าว</button>}
    </div>
  );
}

function Modal({ children, onClose, wide = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className={`modal ${wide ? "wide" : ""}`} onMouseDown={(event) => event.stopPropagation()}>{children}</section></div>;
}

function AddFeedModal({ categories, onClose, onAdded }: { categories: string[]; onClose: () => void; onAdded: (message: string) => void }) {
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState(categories[0] || "ทั่วไป");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.addFeed(url, category || "ทั่วไป");
      onAdded(`เพิ่ม ${result.feed.title} และนำเข้า ${result.importedArticles} ข่าวแล้ว`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เพิ่ม RSS ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-header"><div><span className="eyebrow">NEW SOURCE</span><h2>เพิ่มแหล่งข่าว</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div>
      <p className="modal-intro">วาง URL ของ RSS หรือ Atom feed ระบบจะอ่านชื่อและนำเข้าข่าวล่าสุดให้อัตโนมัติ</p>
      <label className="field-label">RSS URL<input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/feed.xml" inputMode="url" /></label>
      <label className="field-label">หมวดหมู่<input value={category} onChange={(event) => setCategory(event.target.value)} list="categories" placeholder="เช่น เทคโนโลยี" /><datalist id="categories">{categories.map((item) => <option key={item} value={item} />)}</datalist></label>
      {error && <div className="inline-error">{error}</div>}
      <div className="modal-actions"><button className="secondary-button" onClick={onClose}>ยกเลิก</button><button className="primary-button" onClick={() => void submit()} disabled={busy || !url}>{busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}เพิ่ม RSS</button></div>
    </Modal>
  );
}

function SettingsModal({ feeds, readerFontSize, onReaderFontSizeChange, onClose, onRefresh, onRefreshFeed, onBackfill, onDelete, onDisconnect }: {
  feeds: Feed[];
  readerFontSize: number;
  onReaderFontSizeChange: (size: number) => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onRefreshFeed: (feedId: string) => Promise<void>;
  onBackfill: (feedId: string) => Promise<void>;
  onDelete: (feedId: string) => Promise<void>;
  onDisconnect: () => void;
}) {
  const [tab, setTab] = useState<"devices" | "reading" | "feeds">("devices");
  const [busy, setBusy] = useState(false);
  const [busyFeedId, setBusyFeedId] = useState("");
  const [copied, setCopied] = useState("");
  const [syncToken, setSyncToken] = useState(api.token);
  const pairingLink = api.pairingLink();

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1800);
  };

  return (
    <Modal onClose={onClose} wide>
      <div className="modal-header"><div><span className="eyebrow">SETTINGS</span><h2>ตั้งค่า Leafline</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div>
      <div className="settings-tabs"><button className={tab === "devices" ? "active" : ""} onClick={() => setTab("devices")}><Smartphone size={17} />อุปกรณ์</button><button className={tab === "reading" ? "active" : ""} onClick={() => setTab("reading")}><Type size={17} />การอ่าน</button><button className={tab === "feeds" ? "active" : ""} onClick={() => setTab("feeds")}><Inbox size={17} />แหล่งข่าว</button></div>
      {tab === "devices" ? (
        <div className="pairing-layout">
          <div className="qr-card"><QRCodeSVG value={pairingLink} size={174} bgColor="transparent" fgColor="currentColor" level="M" /><span>สแกนด้วยกล้องของอุปกรณ์ใหม่</span></div>
          <div className="pairing-copy">
            <span className="eyebrow">PAIR A NEW DEVICE</span>
            <h3>อ่านต่อได้จากทุกเครื่อง</h3>
            <p>สแกน QR จาก iPhone หรือ Tablet ระบบจะเชื่อมต่อและเริ่มซิงก์ทันทีโดยไม่ต้อง Login</p>
            <button className="secondary-button full" onClick={() => void copy(pairingLink, "link")}><Smartphone size={17} />{copied === "link" ? "คัดลอกแล้ว" : "คัดลอกลิงก์เชื่อมอุปกรณ์"}</button>
            <details><summary>แสดง Sync code <ChevronDown size={15} /></summary><code>{syncToken}</code><button className="small-copy" onClick={() => void copy(syncToken, "code")}>{copied === "code" ? "คัดลอกแล้ว" : "คัดลอก"}</button></details>
            <div className="server-line"><span className="online-dot" /><div><strong>Cloudflare Worker เชื่อมต่อแล้ว</strong><small>{api.apiUrl}</small></div></div>
            <div className="security-actions">
              <button className="danger-text-button" onClick={onDisconnect}><Unplug size={16} />ตัดการเชื่อมต่อเครื่องนี้</button>
              <button className="danger-text-button" onClick={() => {
                if (!confirm("สร้าง Sync code ใหม่? อุปกรณ์เครื่องอื่นจะหยุดซิงก์จนกว่าจะสแกน QR ใหม่")) return;
                setBusy(true);
                void api.rotateToken().then((token) => {
                  setSyncToken(token);
                  setCopied("");
                }).finally(() => setBusy(false));
              }} disabled={busy}><RefreshCw size={16} />ยกเลิกอุปกรณ์อื่นและสร้างรหัสใหม่</button>
            </div>
          </div>
        </div>
      ) : tab === "reading" ? (
        <section className="reader-font-setting">
          <div className="reader-font-setting-head"><Type size={19} /><div><strong>ขนาดตัวอักษรบทความ</strong><small>บันทึกเฉพาะอุปกรณ์นี้ ไม่ซิงก์ทับเครื่องอื่น</small></div><output>{readerFontSize}px</output></div>
          <label className="reader-font-slider"><span aria-hidden="true">ก</span><input type="range" min={READER_FONT_SIZE_MIN} max={READER_FONT_SIZE_MAX} step="1" value={readerFontSize} onChange={(event) => onReaderFontSizeChange(Number(event.target.value))} aria-label="ขนาดตัวอักษรบทความบนอุปกรณ์นี้" /><span aria-hidden="true">ก</span></label>
          <p className="reader-font-preview" style={{ fontSize: readerFontSize }}>ตัวอย่างเนื้อหาข่าว อ่านสบายตาในขนาดที่เหมาะกับหน้าจอนี้</p>
        </section>
      ) : (
        <div className="feed-settings">
          <div className="feed-settings-head"><p>{feeds.length} แหล่งข่าว · ปกติ {feeds.filter((feed) => !feed.lastError).length} · มีปัญหา {feeds.filter((feed) => feed.lastError).length}</p><button className="secondary-button" disabled={busy} onClick={() => { setBusy(true); void onRefresh().finally(() => setBusy(false)); }}><RefreshCw className={busy ? "spin" : ""} size={16} />ตรวจทุกแหล่งตอนนี้</button></div>
          <div className="feed-settings-list">
            {feeds.map((feed) => <div key={feed.id}><span className="feed-avatar" style={{ background: feedColor(feed.title) }}>{initials(feed.title)}</span><div><strong>{feed.title}</strong><small className={feed.lastError ? "feed-error" : ""}>{feed.category} · {feed.lastError ? `ผิดพลาด: ${feed.lastError}` : `อัปเดต ${relativeDate(feed.lastFetchedAt)}`}</small></div><div className="feed-setting-actions"><button className="icon-button" title="อัปเดตแหล่งนี้" disabled={Boolean(busyFeedId)} onClick={() => { setBusyFeedId(feed.id); void onRefreshFeed(feed.id).finally(() => setBusyFeedId("")); }}><RefreshCw className={busyFeedId === feed.id ? "spin" : ""} size={16} /></button><button className="icon-button" title="นำเข้าข่าวย้อนหลัง 5 หน้า" disabled={Boolean(busyFeedId)} onClick={() => { setBusyFeedId(feed.id); void onBackfill(feed.id).finally(() => setBusyFeedId("")); }}><ArchiveRestore size={16} /></button><button className="icon-button danger" title="ลบแหล่งข่าว" onClick={() => { if (confirm(`ลบ ${feed.title} และข่าวทั้งหมดจากแหล่งนี้?`)) void onDelete(feed.id); }}><Trash2 size={17} /></button></div></div>)}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default App;
