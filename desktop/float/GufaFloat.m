/**
 * 古法编程 · 桌面悬浮层（P0，Objective-C 实现）
 *
 * 独立小窗口进程：加载 DSH Web GUI 的「古法编程」，做成半透明、无边框、永远置顶的悬浮窗。
 * 由 dsh-gufa-code Host 半启动：
 *   gufa-float '<json>'   json = {"authUrl":"http://127.0.0.1:PORT/?token=...","appUrl":"http://127.0.0.1:PORT/"}
 *
 * 交互：
 * - 顶部 22px 拖动条移动窗口（窗口本身也可 resize）；
 * - 菜单栏「古法」图标：切换点击穿透 / 重置窗口 / 关闭。
 */
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#include <dlfcn.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <signal.h>

static const EventHotKeyID GufaToggleHotKey = {'gufa', 1};

/* 前置声明（实现位于文件后半部分） */
static NSString *GufaOutputPath = nil;
/** 悬浮层诊断日志（/tmp/gufa-float-debug.log）。 */
static void GufaLog(NSString *format, ...) {
    va_list args;
    va_start(args, format);
    NSString *message = [[NSString alloc] initWithFormat:format arguments:args];
    va_end(args);
    NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
    NSString *line = [NSString stringWithFormat:@"[%@] %@\n", [formatter stringFromDate:[NSDate date]], message];
    NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:@"/tmp/gufa-float-debug.log"];
    if (handle == nil) {
        [line writeToFile:@"/tmp/gufa-float-debug.log" atomically:YES encoding:NSUTF8StringEncoding error:NULL];
    } else {
        [handle seekToEndOfFile];
        [handle writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
        [handle closeFile];
    }
}
static void GufaEmitJSON(NSDictionary *out);

#ifndef GUFA_FLOAT_VERSION
#define GUFA_FLOAT_VERSION "dev"
#endif
static BOOL GufaTrustedForAX(void);
static NSArray<NSDictionary *> *GufaAXWindows(void);
static AXUIElementRef GufaCopyAXWindow(pid_t pid, NSString *title);
static BOOL GufaRectFromAX(AXUIElementRef element, NSRect *out);
static void GufaActivateBundle(NSString *bundleId);
static BOOL GufaAXWindowFullScreen(AXUIElementRef window);
static CGWindowID GufaAXWindowNumber(AXUIElementRef window);
static int GufaMoveWindowToTargetSpace(NSWindow *window, AXUIElementRef targetWindow);
static void GufaLogOwnWindowState(NSString *tag);
static void GufaSetMainAppHidden(BOOL hidden);
static NSArray<NSDictionary *> *GufaAXApps(void);
static AXUIElementRef GufaCopyAppWindow(pid_t pid);

/* SIGTERM 时先把主窗口（DeepSeek Harness）唤回前台，再退出，实现「退出摸鱼」 */
static void GufaInstallTermHandler(void);

@class GufaAppDelegate;

static OSStatus GufaHotKeyHandler(EventHandlerCallRef nextHandler, EventRef event, void *userData);

/* 无边框窗口默认 canBecomeKeyWindow=NO；显式允许成为 key/main 窗口，
   否则悬浮层里的终端/编辑器/聊天输入都收不到键盘事件。 */
@interface GufaFloatWindow : NSWindow
@end
@implementation GufaFloatWindow
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return YES; }
@end

@interface GufaDragStrip : NSView
@end

@implementation GufaDragStrip

- (BOOL)isOpaque { return NO; }

- (void)drawRect:(NSRect)dirtyRect {
    [[NSColor colorWithCalibratedWhite:0.0 alpha:0.22] setFill];
    NSRectFill(dirtyRect);
    NSDictionary *attrs = @{
        NSFontAttributeName: [NSFont systemFontOfSize:10 weight:NSFontWeightMedium],
        NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:1.0 alpha:0.6],
    };
    NSString *label = @"古法编程 · 摸鱼中（拖动移动 · 右键菜单 · ⌃⌥⌘G 切穿透）";
    NSSize size = [label sizeWithAttributes:attrs];
    NSPoint origin = NSMakePoint(floor((self.bounds.size.width - size.width) / 2.0), floor((self.bounds.size.height - size.height) / 2.0));
    [label drawAtPoint:origin withAttributes:attrs];
}

- (void)mouseDragged:(NSEvent *)event {
    /* performDrag 已接管拖动 */
}

- (void)rightMouseDown:(NSEvent *)event {
    /* 右键直接弹出悬浮层菜单（菜单栏图标太挤时也能用） */
    if (self.menu != nil) {
        [NSMenu popUpContextMenu:self.menu withEvent:event forView:self];
        return;
    }
    [super rightMouseDown:event];
}

- (void)mouseDown:(NSEvent *)event {
    [self.window performWindowDragWithEvent:event];
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }

@end

@class GufaAppDelegate;

@interface GufaNavigationDelegate : NSObject <WKNavigationDelegate>
@property (nonatomic, weak) GufaAppDelegate *owner;
@property (nonatomic, copy) void (^pendingLoad)(void);
@end

@interface GufaAppDelegate : NSObject <NSApplicationDelegate>
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) WKWebView *webView;
@property (nonatomic, strong) NSStatusItem *statusItem;
@property (nonatomic, strong) NSMenu *mainMenu;
@property (nonatomic, strong) GufaDragStrip *dragStrip;
@property (nonatomic, assign) BOOL cachesCleared;
@property (nonatomic, strong) NSString *controlPath;
@property (nonatomic, strong) NSTimer *controlTimer;
@property (nonatomic, assign) BOOL clickThrough;
@property (nonatomic, strong) NSString *frameKey;
@property (nonatomic, strong) GufaNavigationDelegate *navigation;
@property (nonatomic, strong) NSDictionary *options;
@property (nonatomic, assign) EventHotKeyRef hotKeyRef;
@property (nonatomic, assign) BOOL following;
@property (nonatomic, assign) pid_t followPid;
@property (nonatomic, copy) NSString *followTitle;
@property (nonatomic, assign) AXUIElementRef followWindowRef;
@property (nonatomic, strong) NSTimer *followTimer;
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *windowCandidates;
- (void)loadWebContent;
- (void)registerToggleHotKey;
- (void)activateTargetApp;
- (void)beginningFollowFromOptions;
- (void)findFollowWindowWithRetries:(NSInteger)attempt;
- (void)exitMoyu:(id)sender;
- (void)restoreMainWindow;
- (void)clearWebCachesThenLoad;
- (void)performInitialLoad;
- (void)applySpaceBehaviorFollowing:(BOOL)following;
- (void)attachToFollowedSpace;
- (void)watchControlFile;
- (void)gracefulExit;
- (void)toggleClickThrough:(id)sender;
- (void)resetFrame:(id)sender;
- (void)quitApp:(id)sender;
- (void)saveFrame;
@end

@implementation GufaNavigationDelegate
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    void (^next)(void) = self.pendingLoad;
    if (next != nil) {
        self.pendingLoad = nil;
        next();
    }
}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSLog(@"gufa-float navigation error: %@", error);
}
@end

@implementation GufaAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.frameKey = @"gufa-float-frame-v1";
    self.clickThrough = NO;
    [self parseOptions];
    if ([self.options[@"controlPath"] isKindOfClass:[NSString class]]) self.controlPath = self.options[@"controlPath"];
    [self watchControlFile];
    /* 先激活目标 App：等它切到自己的 Space/全屏 Space 后再创建悬浮窗，
       窗口就会直接创建在目标 Space 里（全屏 App 吸附的关键）。 */
    BOOL hasFollow = [self.options[@"follow"] isKindOfClass:[NSDictionary class]];
    [self activateTargetApp];
    NSTimeInterval delay = hasFollow ? 0.9 : 0.0;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        __strong typeof(weakSelf) self = weakSelf;
        if (self == nil) return;
        [self buildWindow];
        [self buildStatusItem];
        [self registerToggleHotKey];
        /* 摸鱼：等目标 App 到前台后隐藏 DSH 主窗口（⌘H 效果） */
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.45 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            GufaSetMainAppHidden(YES);
        });
        [self beginningFollowFromOptions];
        [self loadWebContent];
    });
}

/** 吸附目标 App：把它切到前台（主窗口自然被盖住 + 切到它所在的 Space）。 */
- (void)activateTargetApp {
    NSDictionary *follow = self.options[@"follow"];
    if (![follow isKindOfClass:[NSDictionary class]]) return;
    NSString *bundleId = [follow[@"bundleId"] isKindOfClass:[NSString class]] ? follow[@"bundleId"] : @"";
    if (bundleId.length > 0) {
        GufaActivateBundle(bundleId);
        return;
    }
    NSNumber *pid = follow[@"pid"];
    if (![pid isKindOfClass:[NSNumber class]]) return;
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:(pid_t)pid.intValue];
    if (app != nil) GufaActivateBundle(app.bundleIdentifier);
}

/** 启动就进入「吸附跟随」模式（摸鱼列表选好 App 后直接启动）。 */
- (void)beginningFollowFromOptions {
    NSDictionary *follow = self.options[@"follow"];
    if (![follow isKindOfClass:[NSDictionary class]]) {
        /* 自由悬浮：没有吸附目标，允许出现在所有 Space */
        [self applySpaceBehaviorFollowing:NO];
        return;
    }
    NSNumber *pid = follow[@"pid"];
    if (![pid isKindOfClass:[NSNumber class]]) {
        [self applySpaceBehaviorFollowing:NO];
        return;
    }
    self.followPid = (pid_t)pid.intValue;
    self.followTitle = [follow[@"title"] isKindOfClass:[NSString class]] ? follow[@"title"] : @"";
    GufaLog(@"follow-start pid=%d bundle=%@ axTrusted=%d", self.followPid, follow[@"bundleId"] ?: @"", GufaTrustedForAX() ? 1 : 0);
    [self findFollowWindowWithRetries:0];
}

/* 激活 App 后窗口可能还在切 Space，轮询最多 5 秒找它的窗口。 */
- (void)findFollowWindowWithRetries:(NSInteger)attempt {
    AXUIElementRef window = GufaCopyAppWindow(self.followPid);
    if (window == NULL) {
        if (attempt >= 20) {
            GufaLog(@"follow-window-not-found pid=%d attempts=%ld axTrusted=%d", self.followPid, (long)attempt, GufaTrustedForAX() ? 1 : 0);
            return;
        }
        __weak typeof(self) weakSelf = self;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [weakSelf findFollowWindowWithRetries:attempt + 1];
        });
        return;
    }
    NSRect rect = NSZeroRect;
    GufaRectFromAX(window, &rect);
    BOOL fullScreen = GufaAXWindowFullScreen(window);
    GufaLog(@"follow-window-found pid=%d rect=%.0f,%.0f %.0fx%.0f fullscreen=%d attempt=%ld", self.followPid, rect.origin.x, rect.origin.y, rect.size.width, rect.size.height, fullScreen ? 1 : 0, (long)attempt);
    if (self.followWindowRef != NULL) CFRelease(self.followWindowRef);
    self.followWindowRef = window;
    self.following = YES;
    /* 吸附模式：窗口只留在「被跟随 App 所在的 Space」，用户切屏不跟过去 */
    [self applySpaceBehaviorFollowing:YES];
    [self startFollowTimer];
    [self applyFollowFrame];
    [self attachToFollowedSpace];
    self.statusItem.button.title = @"古法·摸鱼";
}

/* Host 的 float.stop 通过「控制文件」通知退出：写入文件 → helper 恢复主窗口后自行退出。
   （SIGTERM 在该 AppKit 进程里不可靠，实测 dispatch signal source 不触发） */
- (void)watchControlFile {
    if (self.controlPath.length == 0) return;
    self.controlTimer = [NSTimer scheduledTimerWithTimeInterval:0.3 repeats:YES block:^(NSTimer *timer) {
        if (self.controlPath.length == 0) return;
        if (![[NSFileManager defaultManager] fileExistsAtPath:self.controlPath]) return;
        [timer invalidate];
        self.controlTimer = nil;
        [[NSFileManager defaultManager] removeItemAtPath:self.controlPath error:NULL];
        [self gracefulExit];
    }];
}

- (void)gracefulExit {
    GufaLog(@"graceful-exit path=%@", self.controlPath ?: @"");
    [self restoreMainWindow];
    [self stopFollowTimer];
    [self saveFrame];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.15 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [NSApp terminate:nil];
    });
}

/* 把悬浮窗挪到「被跟随 App 当前所在的 Space」：
   先 MoveToActiveSpace 排序到前台（目标 App 已被激活，其全屏 Space 即当前活动 Space），
   再恢复为固定 Space 行为，这样之后用户滑屏不会把它带走。 */
- (void)attachToFollowedSpace {
    if (self.window == nil) return;
    NSWindowCollectionBehavior base = (NSWindowCollectionBehaviorFullScreenAuxiliary
                                      | NSWindowCollectionBehaviorIgnoresCycle);
    /* 首选：SkyLight 直接把窗口放进目标 App 窗口所在的 Space（全屏/多屏最可靠） */
    int moveErr = GufaMoveWindowToTargetSpace(self.window, self.followWindowRef);
    (void)moveErr;
    /* 兜底：MoveToActiveSpace 排序到前台 */
    self.window.collectionBehavior = base | NSWindowCollectionBehaviorMoveToActiveSpace;
    [self.window orderFrontRegardless];
    [self.window makeKeyWindow];
    GufaLog(@"space-jump moveToActiveSpace screen=%@", self.window.screen == nil ? @"nil" : NSStringFromRect(self.window.screen.frame));
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.9 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        __strong typeof(weakSelf) self = weakSelf;
        if (self == nil || self.window == nil) return;
        self.window.collectionBehavior = base;
        GufaLog(@"space-attached screen=%@", self.window.screen == nil ? @"nil" : NSStringFromRect(self.window.screen.frame));
        GufaLogOwnWindowState(@"space-attached");
    });
}

/* Space 行为：跟随 App 时固定在其 Space；自由悬浮时允许出现在所有 Space。 */
- (void)applySpaceBehaviorFollowing:(BOOL)following {
    if (self.window == nil) return;
    NSWindowCollectionBehavior behavior = (NSWindowCollectionBehaviorFullScreenAuxiliary
                                          | NSWindowCollectionBehaviorIgnoresCycle);
    if (!following) behavior |= NSWindowCollectionBehaviorCanJoinAllSpaces;
    self.window.collectionBehavior = behavior;
    GufaLog(@"space-behavior following=%d raw=%lu", following ? 1 : 0, (unsigned long)behavior);
}

- (void)parseOptions {
    NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
    if (args.count < 2) return;
    NSData *data = [args[1] dataUsingEncoding:NSUTF8StringEncoding];
    if (data == nil) return;
    id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    if ([parsed isKindOfClass:[NSDictionary class]]) self.options = parsed;
}

- (void)buildWindow {
    NSRect frame = NSMakeRect(0, 0, 1180, 820);
    NSString *saved = [[NSUserDefaults standardUserDefaults] stringForKey:self.frameKey];
    if (saved.length > 0) {
        NSRect parsed = NSRectFromString(saved);
        if (parsed.size.width > 320 && parsed.size.height > 240) frame = parsed;
    } else if (NSScreen.mainScreen != nil) {
        NSRect visible = NSScreen.mainScreen.visibleFrame;
        NSString *menuSetting = [[NSUserDefaults standardUserDefaults] stringForKey:@"gufa-float-corner"];
        if ([menuSetting isEqualToString:@"center"] || menuSetting == nil) {
            CGFloat width = MIN(1180, visible.size.width * 0.86);
            CGFloat height = MIN(820, visible.size.height * 0.86);
            frame = NSMakeRect(visible.origin.x + (visible.size.width - width) / 2.0,
                               visible.origin.y + (visible.size.height - height) / 2.0,
                               width, height);
        }
    }

    self.window = [[GufaFloatWindow alloc] initWithContentRect:frame
                                             styleMask:(NSWindowStyleMaskBorderless | NSWindowStyleMaskResizable)
                                               backing:NSBackingStoreBuffered
                                                 defer:NO];
    self.window.opaque = NO;
    self.window.backgroundColor = NSColor.clearColor;
    self.window.hasShadow = YES;
    /* 高于普通浮动窗口（歌词、置顶小工具等），确保真正盖住被跟随的 App */
    self.window.level = NSStatusWindowLevel;
    /* 固定吸附：默认不加入所有 Space（否则用户滑动切屏时摸鱼窗会跟着跑到当前屏）；
       只有「自由悬浮」模式才允许出现在所有 Space。 */
    self.window.collectionBehavior = (NSWindowCollectionBehaviorFullScreenAuxiliary
                                      | NSWindowCollectionBehaviorIgnoresCycle);
    self.window.minSize = NSMakeSize(520, 360);
    self.window.title = @"古法编程悬浮层";

    NSView *container = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
    container.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    container.wantsLayer = YES;

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
    /* 文档开始前注入：悬浮模式标记 + 主窗口状态（项目/UI 布局/打开的标签页/会话），
       让悬浮窗里的古法编程「接着主窗口继续干活」，而不是一个空白的新实例。 */
    NSMutableString *bootstrap = [NSMutableString stringWithString:@"try{localStorage.setItem('gufa-code:float','1');"];
    NSDictionary *state = [self.options[@"state"] isKindOfClass:[NSDictionary class]] ? self.options[@"state"] : nil;
    if (state != nil) {
        NSData *stateJson = [NSJSONSerialization dataWithJSONObject:state options:0 error:NULL];
        if (stateJson != nil) {
            NSString *stateText = [[NSString alloc] initWithData:stateJson encoding:NSUTF8StringEncoding];
            NSString *escaped = [stateText stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"];
            escaped = [escaped stringByReplacingOccurrencesOfString:@"'" withString:@"\\'"];
            escaped = [escaped stringByReplacingOccurrencesOfString:@"\n" withString:@"\\n"];
            escaped = [escaped stringByReplacingOccurrencesOfString:@"\r" withString:@""];
            [bootstrap appendFormat:@"localStorage.setItem('gufa-code:float-state','%@');", escaped];
            NSString *projectRoot = [state[@"projectRoot"] isKindOfClass:[NSString class]] ? state[@"projectRoot"] : @"";
            if (projectRoot.length > 0) {
                NSString *projectEscaped = [projectRoot stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"];
                projectEscaped = [projectEscaped stringByReplacingOccurrencesOfString:@"'" withString:@"\\'"];
                [bootstrap appendFormat:@"localStorage.setItem('gufa-code:project','\"%@\"');", projectEscaped];
            }
            NSDictionary *ui = [state[@"ui"] isKindOfClass:[NSDictionary class]] ? state[@"ui"] : nil;
            if (ui != nil) {
                NSData *uiJson = [NSJSONSerialization dataWithJSONObject:ui options:0 error:NULL];
                if (uiJson != nil) {
                    NSString *uiText = [[NSString alloc] initWithData:uiJson encoding:NSUTF8StringEncoding];
                    NSString *uiEscaped = [uiText stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"];
                    uiEscaped = [uiEscaped stringByReplacingOccurrencesOfString:@"'" withString:@"\\'"];
                    [bootstrap appendFormat:@"localStorage.setItem('gufa-code:ui:v1','%@');", uiEscaped];
                }
            }
        }
    }
    [bootstrap appendString:@"}catch(e){}"];
    WKUserScript *floatMarker = [[WKUserScript alloc] initWithSource:bootstrap
                                                       injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                    forMainFrameOnly:YES];
    [config.userContentController addUserScript:floatMarker];
    self.webView = [[WKWebView alloc] initWithFrame:container.bounds configuration:config];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.navigation = [[GufaNavigationDelegate alloc] init];
    self.navigation.owner = self;
    self.webView.navigationDelegate = self.navigation;
    [self.webView setValue:@NO forKey:@"drawsBackground"];
    [container addSubview:self.webView];

    CGFloat stripHeight = 22.0;
    GufaDragStrip *strip = [[GufaDragStrip alloc] initWithFrame:NSMakeRect(0, frame.size.height - stripHeight, frame.size.width, stripHeight)];
    strip.autoresizingMask = NSViewWidthSizable | NSViewMinYMargin;
    strip.menu = self.mainMenu;
    [container addSubview:strip];
    self.dragStrip = strip;

    self.window.contentView = container;
    if (self.window.frame.size.width < 400 || self.window.frame.size.height < 300) {
        NSRect visible = NSScreen.mainScreen.visibleFrame;
        CGFloat width = MIN(1180, visible.size.width * 0.86);
        CGFloat height = MIN(820, visible.size.height * 0.86);
        [self.window setFrame:NSMakeRect(visible.origin.x + (visible.size.width - width) / 2.0,
                                        visible.origin.y + (visible.size.height - height) / 2.0,
                                        width, height) display:YES];
    }
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    GufaLog(@"window-frame %@ visible=%d level=%ld activeSpace=%d screen=%@ alpha=%.2f", NSStringFromRect(self.window.frame), self.window.isVisible ? 1 : 0, (long)self.window.level, self.window.isOnActiveSpace ? 1 : 0, self.window.screen == nil ? @"nil" : NSStringFromRect(self.window.screen.frame), self.window.alphaValue);
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(saveFrame) name:NSWindowDidEndLiveResizeNotification object:self.window];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(saveFrame) name:NSWindowDidMoveNotification object:self.window];
}

- (void)buildStatusItem {
    self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
    self.statusItem.button.title = @"古法";
    self.statusItem.button.toolTip = @"古法编程悬浮层";
    NSMenu *menu = [[NSMenu alloc] init];
    [menu addItemWithTitle:@"跟随 App 窗口…（需辅助功能权限）" action:@selector(chooseFollowWindow:) keyEquivalent:@""].target = self;
    [menu addItemWithTitle:@"停止跟随" action:@selector(stopFollow:) keyEquivalent:@""].target = self;
    [menu addItem:[NSMenuItem separatorItem]];
    [menu addItemWithTitle:@"切换点击穿透（⌃⌥⌘G）" action:@selector(toggleClickThrough:) keyEquivalent:@""].target = self;
    [menu addItemWithTitle:@"重置窗口位置和大小" action:@selector(resetFrame:) keyEquivalent:@""].target = self;
    [menu addItem:[NSMenuItem separatorItem]];
    [menu addItemWithTitle:@"退出摸鱼（关闭悬浮层，回主窗口）" action:@selector(exitMoyu:) keyEquivalent:@""].target = self;
    self.mainMenu = menu;
    self.statusItem.menu = menu;
    /* buildWindow 先于 buildStatusItem 执行，这里补挂右键菜单 */
    self.dragStrip.menu = menu;
}

- (void)loadWebContent {
    NSString *authUrl = self.options[@"authUrl"];
    NSString *appUrl = self.options[@"appUrl"];
    if (authUrl.length == 0 || appUrl.length == 0) {
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"古法编程悬浮层";
        alert.informativeText = @"悬浮层启动参数缺失";
        [alert runModal];
        [NSApp terminate:nil];
        return;
    }
    __weak typeof(self) weakSelf = self;
    self.navigation.pendingLoad = ^{
        __strong typeof(weakSelf) self = weakSelf;
        if (self == nil) return;
        /* 鉴权 cookie 已在 token URL 重定向时写入；这里用 JS 写 localStorage（避开 URL 长度/转义问题），
           再跳到带 gufa-float 标记的干净地址，客户端据此自动进入摸鱼模式并恢复状态。 */
        NSMutableString *js = [NSMutableString stringWithString:@"try{"];
        NSDictionary *state = [self.options[@"state"] isKindOfClass:[NSDictionary class]] ? self.options[@"state"] : nil;
        if (state != nil) {
            NSData *stateJson = [NSJSONSerialization dataWithJSONObject:state options:0 error:NULL];
            NSString *stateText = stateJson != nil ? [[NSString alloc] initWithData:stateJson encoding:NSUTF8StringEncoding] : @"";
            if (stateText.length > 0) {
                NSData *quoted = [NSJSONSerialization dataWithJSONObject:@[stateText] options:0 error:NULL];
                NSString *arrayLiteral = quoted != nil ? [[NSString alloc] initWithData:quoted encoding:NSUTF8StringEncoding] : @"[]";
                /* arrayLiteral = ["{\"projectRoot\":...}"] */
                if (arrayLiteral.length >= 2) {
                    NSString *stateLiteral = [arrayLiteral substringWithRange:NSMakeRange(1, arrayLiteral.length - 2)];
                    [js appendFormat:@"localStorage.setItem('gufa-code:float-state', %@);", stateLiteral];
                }
            }
        }
        [js appendString:@"localStorage.setItem('gufa-code:float','1');location.href='/?gufa-float=1';}catch(e){}"];
        [self.webView evaluateJavaScript:js completionHandler:nil];
    };
    [self clearWebCachesThenLoad];

    /* 诊断：6 秒后记录页面地址/标题/正文摘要，便于定位空白窗口 */
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(6.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        NSString *probe = @"(function(){try{var o=document.querySelector('.gufa-overlay-root');var g=(window.__GUFA_CODE__&&window.__GUFA_CODE__.G)||null;return JSON.stringify({href:location.href,build:g?g.BUILD:null,overlay:!!o,vis:o?getComputedStyle(o).visibility:'',body:(document.body?document.body.innerText:'').slice(0,260),tabs:Array.prototype.map.call(document.querySelectorAll('.gufa-tab'),function(n){return (n.textContent||'').trim();}).slice(0,8)});}catch(e){return 'probe-error:'+e;}})()";
        [self.webView evaluateJavaScript:probe completionHandler:^(id result, NSError *error) {
            GufaLog(@"page-probe %@ err=%@", result ?: @"nil", error.localizedDescription ?: @"none");
        }];
    });

    /* 内部 QA：payload.selftest 是一段 JS，页面打开后在悬浮窗里跑一遍并写回诊断日志（仅开发用，不影响 UI） */
    NSString *selftest = [self.options[@"selftest"] isKindOfClass:[NSString class]] ? self.options[@"selftest"] : nil;
    if (selftest.length > 0) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(5.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [self.webView evaluateJavaScript:selftest completionHandler:^(id result, NSError *error) {
                if (error != nil) GufaLog(@"selftest-script-error %@", error.localizedDescription ?: @"?");
            }];
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(6.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                [self.webView evaluateJavaScript:@"JSON.stringify(window.__gufaSelftest||{step:'none'})" completionHandler:^(id result, NSError *error) {
                    GufaLog(@"selftest %@", result ?: @"nil");
                }];
            });
        });
    }

}

/* 清 Web 缓存（保留 cookie/localStorage 不行——要清 localStorage 才能保证状态注入生效）。
   完成后再真正加载页面。 */
- (void)clearWebCachesThenLoad {
    if (self.cachesCleared) return;
    self.cachesCleared = YES;
    /* 版本变了才清全部 Web 数据（保证客户端代码最新）；
       同一版本重复打开摸鱼只清缓存（或干脆不清），避免每次重新编译整个前端（慢且耗内存） */
    NSString *build = [self.options[@"build"] isKindOfClass:[NSString class]] ? self.options[@"build"] : @"";
    NSString *lastBuild = [[NSUserDefaults standardUserDefaults] stringForKey:@"gufa-float-build"];
    BOOL versionChanged = build.length == 0 || lastBuild == nil || ![lastBuild isEqualToString:build];
    NSSet<NSString *> *types = versionChanged
      ? [WKWebsiteDataStore allWebsiteDataTypes]
      : [NSSet setWithObjects:WKWebsiteDataTypeMemoryCache, nil];
    [[WKWebsiteDataStore defaultDataStore] removeDataOfTypes:types modifiedSince:[NSDate dateWithTimeIntervalSince1970:0] completionHandler:^{
        if (build.length > 0) [[NSUserDefaults standardUserDefaults] setObject:build forKey:@"gufa-float-build"];
        dispatch_async(dispatch_get_main_queue(), ^{
            [self performInitialLoad];
        });
    }];
}

- (void)performInitialLoad {
    NSString *authUrl = self.options[@"authUrl"];
    NSString *cookie = [self.options[@"cookie"] isKindOfClass:[NSString class]] ? self.options[@"cookie"] : nil;
    if (cookie.length > 0) {
        NSRange eq = [cookie rangeOfString:@"="];
        if (eq.location != NSNotFound) {
            NSString *name = [cookie substringToIndex:eq.location];
            NSString *value = [cookie substringFromIndex:eq.location + 1];
            NSDictionary *props = @{
                NSHTTPCookieName: name,
                NSHTTPCookieValue: value,
                NSHTTPCookieDomain: @"127.0.0.1",
                NSHTTPCookiePath: @"/",
                NSHTTPCookieExpires: [NSDate dateWithTimeIntervalSinceNow:86400],
            };
            NSHTTPCookie *httpCookie = [NSHTTPCookie cookieWithProperties:props];
            if (httpCookie != nil) {
                WKHTTPCookieStore *store = [WKWebsiteDataStore defaultDataStore].httpCookieStore;
                [store setCookie:httpCookie completionHandler:^{
                    NSURLComponents *components = [NSURLComponents componentsWithString:self.options[@"appUrl"] ?: @""];
                    components.queryItems = @[[NSURLQueryItem queryItemWithName:@"gufa-float" value:@"1"]];
                    [self.webView loadRequest:[NSURLRequest requestWithURL:components.URL]];
                }];
                return;
            }
        }
    }
    [self.webView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:authUrl ?: @""]]];
}

- (void)saveFrame {
    if (self.window == nil) return;
    [[NSUserDefaults standardUserDefaults] setObject:NSStringFromRect(self.window.frame) forKey:self.frameKey];
}

static CGWindowID GufaAXWindowNumber(AXUIElementRef window) {
    if (window == NULL) return 0;
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(window, CFSTR("AXWindowNumber"), &value) != kAXErrorSuccess || value == NULL) return 0;
    CGWindowID number = 0;
    if (CFGetTypeID(value) == CFNumberGetTypeID()) CFNumberGetValue((CFNumberRef)value, kCFNumberSInt32Type, &number);
    CFRelease(value);
    return number;
}

/* 用 SkyLight 私有 API 把窗口移动/加入到目标窗口所在的 Space。
   这比 collectionBehavior 的 MoveToActiveSpace 可靠（全屏 Space / 多屏下窗口不动的问题）。 */
static int GufaMoveWindowToTargetSpace(NSWindow *window, AXUIElementRef targetWindow) {
    if (window == nil || targetWindow == NULL) return -1;
    CGWindowID targetWid = GufaAXWindowNumber(targetWindow);
    CGWindowID ownWid = (CGWindowID)window.windowNumber;
    if (ownWid == 0) {
        GufaLog(@"space-move skip ownWid=0");
        return -2;
    }
    GufaLog(@"space-move start targetWid=%u ownWid=%u", targetWid, ownWid);
    void *handle = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY);
    if (handle == NULL) {
        GufaLog(@"space-move dlopen-failed %s", dlerror());
        return -3;
    }
    typedef int (*MainConnectionFn)(void);
    typedef uint64_t (*GetActiveSpaceFn)(int);
    typedef int (*GetWindowWorkspaceFn)(int, CGWindowID, uint64_t *);
    typedef int (*AddWindowsToSpacesFn)(int, CFArrayRef, CFArrayRef);
    MainConnectionFn mainConn = (MainConnectionFn)dlsym(handle, "SLSMainConnectionID");
    if (mainConn == NULL) mainConn = (MainConnectionFn)dlsym(handle, "CGSMainConnectionID");
    GetWindowWorkspaceFn getWorkspace = (GetWindowWorkspaceFn)dlsym(handle, "SLSGetWindowWorkspace");
    if (getWorkspace == NULL) getWorkspace = (GetWindowWorkspaceFn)dlsym(handle, "CGSGetWindowWorkspace");
    GetActiveSpaceFn getActiveSpace = (GetActiveSpaceFn)dlsym(handle, "SLSGetActiveSpace");
    if (getActiveSpace == NULL) getActiveSpace = (GetActiveSpaceFn)dlsym(handle, "CGSGetActiveSpace");
    AddWindowsToSpacesFn addWindows = (AddWindowsToSpacesFn)dlsym(handle, "SLSAddWindowsToSpaces");
    if (addWindows == NULL) addWindows = (AddWindowsToSpacesFn)dlsym(handle, "CGSAddWindowsToSpaces");
    if (mainConn == NULL || getWorkspace == NULL || addWindows == NULL) {
        GufaLog(@"space-move symbols missing main=%d get=%d add=%d", mainConn != NULL, getWorkspace != NULL, addWindows != NULL);
        dlclose(handle);
        return -4;
    }
    int cid = mainConn();
    uint64_t targetSpace = 0;
    if (targetWid != 0 && getWorkspace != NULL) {
        int getErr = getWorkspace(cid, targetWid, &targetSpace);
        if (getErr != 0) GufaLog(@"space-move target-workspace failed err=%d", getErr);
    }
    if (targetSpace == 0 && getActiveSpace != NULL) {
        /* 拿不到目标窗口 id（AX 不暴露 AXWindowNumber）时，目标 App 已激活，
           直接把我们的窗口加进当前活动 Space（= 目标 App 的 Space） */
        targetSpace = getActiveSpace(cid);
        GufaLog(@"space-move use-active-space=%llu", (unsigned long long)targetSpace);
    }
    if (targetSpace == 0) {
        GufaLog(@"space-move no-target-space (targetWid=%u activeSpaceApi=%d)", targetWid, getActiveSpace != NULL);
        dlclose(handle);
        return -5;
    }
    CFArrayRef windows = (__bridge CFArrayRef)@[@(ownWid)];
    CFArrayRef spaces = (__bridge CFArrayRef)@[@(targetSpace)];
    int addErr = addWindows(cid, windows, spaces);
    dlclose(handle);
    GufaLog(@"space-move ownWid=%u targetWid=%u space=%llu err=%d", ownWid, targetWid, (unsigned long long)targetSpace, addErr);
    return addErr;
}

/* 自身窗口在 WindowServer 里是否 onscreen / 在哪块屏幕（Space 占用排查用） */
static void GufaLogOwnWindowState(NSString *tag) {
    NSArray<NSDictionary *> *windows = (__bridge_transfer NSArray *)CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID);
    pid_t selfPid = NSProcessInfo.processInfo.processIdentifier;
    for (NSDictionary *info in windows) {
        NSNumber *owner = info[(__bridge NSString *)kCGWindowOwnerPID];
        if (owner == nil || owner.intValue != selfPid) continue;
        NSNumber *onscreen = info[(__bridge NSString *)kCGWindowIsOnscreen];
        NSDictionary *bounds = info[(__bridge NSString *)kCGWindowBounds];
        GufaLog(@"%@ own-window onscreen=%d bounds=%@ layer=%@", tag, onscreen == nil ? -1 : onscreen.intValue, bounds ?: @{}, info[(__bridge NSString *)kCGWindowLayer] ?: @"?");
    }
}

/* ── 跟随选中的 App 窗口（Accessibility API） ─────────────────────── */

- (void)showPermissionGuide {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"需要「辅助功能」权限";
    alert.informativeText = @"摸鱼列表要读取其他 App 窗口的位置和大小，需要「辅助功能」权限：\n\n系统设置 → 隐私与安全性 → 辅助功能 → 打开 DeepSeek Harness（以及「古法编程悬浮层」）的开关；改完后点「重试」。\n\n（只读取窗口尺寸/位置，不录屏、不采集画面。）";
    [alert addButtonWithTitle:@"打开系统设置"];
    [alert addButtonWithTitle:@"取消"];
    if ([alert runModal] == NSAlertFirstButtonReturn) {
        [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]];
    }
}

- (void)chooseFollowWindow:(id)sender {
    if (!GufaTrustedForAX()) {
        [self showPermissionGuide];
        return;
    }
    NSArray<NSDictionary *> *rows = GufaAXApps();
    if (rows.count == 0) {
        [self showPermissionGuide];
        return;
    }
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"选择要吸附的 App";
    alert.informativeText = @"悬浮层会切到该 App 的窗口并保持相同位置/大小，窗口移动时自动跟随。";
    NSPopUpButton *popup = [[NSPopUpButton alloc] initWithFrame:NSMakeRect(0, 0, 420, 26) pullsDown:NO];
    for (NSDictionary *row in rows) [popup addItemWithTitle:row[@"name"] ?: @"?"];
    alert.accessoryView = popup;
    [alert addButtonWithTitle:@"开始摸鱼"];
    [alert addButtonWithTitle:@"取消"];
    if ([alert runModal] != NSAlertFirstButtonReturn) return;
    NSInteger index = popup.indexOfSelectedItem;
    if (index < 0 || index >= (NSInteger)rows.count) return;
    NSDictionary *row = rows[(NSUInteger)index];
    self.followPid = (pid_t)[row[@"pid"] intValue];
    self.followTitle = @"";
    if (self.followWindowRef != NULL) { CFRelease(self.followWindowRef); self.followWindowRef = NULL; }
    GufaActivateBundle(row[@"bundleId"]);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.6 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        self.followWindowRef = GufaCopyAppWindow(self.followPid);
        if (self.followWindowRef == NULL) return;
        self.following = YES;
        [self applySpaceBehaviorFollowing:YES];
        [self startFollowTimer];
        [self applyFollowFrame];
        self.statusItem.button.title = @"古法·摸鱼";
    });
}

- (void)stopFollow:(id)sender {
    [self stopFollowTimer];
    [self applySpaceBehaviorFollowing:NO];
    self.statusItem.button.title = self.clickThrough ? @"古法·穿透" : @"古法";
}

/* 只重启定时器，不动 following/窗口引用（stopFollowTimer 会清状态，不能在这里调） */
- (void)startFollowTimer {
    if (self.followTimer != nil) {
        [self.followTimer invalidate];
        self.followTimer = nil;
    }
    __weak typeof(self) weakSelf = self;
    self.followTimer = [NSTimer scheduledTimerWithTimeInterval:0.25 repeats:YES block:^(NSTimer *timer) {
        __strong typeof(weakSelf) self = weakSelf;
        if (self == nil) return;
        [self applyFollowFrame];
    }];
}

- (void)stopFollowTimer {
    if (self.followTimer != nil) {
        [self.followTimer invalidate];
        self.followTimer = nil;
    }
    self.following = NO;
    if (self.followWindowRef != NULL) {
        CFRelease(self.followWindowRef);
        self.followWindowRef = NULL;
    }
}

/** 读取被跟随窗口当前 bounds，把悬浮窗贴上去（主屏坐标换算；多屏后续再完善）。 */
- (void)applyFollowFrame {
    if (!self.following) return;
    if (self.followWindowRef == NULL) {
        self.followWindowRef = GufaCopyAXWindow(self.followPid, self.followTitle);
        if (self.followWindowRef == NULL) {
            [self stopFollowTimer];
            self.statusItem.button.title = @"古法";
            return;
        }
    }
    NSRect target = NSZeroRect;
    if (!GufaRectFromAX(self.followWindowRef, &target)) {
        [self stopFollowTimer];
        self.statusItem.button.title = @"古法";
        return;
    }
    CGFloat screenHeight = NSScreen.mainScreen.frame.size.height;
    NSRect frame = NSMakeRect(target.origin.x, screenHeight - target.origin.y - target.size.height, target.size.width, target.size.height);
    static int applyLogCount = 0;
    if (applyLogCount < 6) {
        applyLogCount += 1;
        GufaLog(@"follow-apply target=%.0f,%.0f %.0fx%.0f -> frame=%.0f,%.0f %.0fx%.0f", target.origin.x, target.origin.y, target.size.width, target.size.height, frame.origin.x, frame.origin.y, frame.size.width, frame.size.height);
    }
    [self.window setFrame:frame display:YES animate:NO];
    static int verifyLogCount = 0;
    if (verifyLogCount < 3) {
        verifyLogCount += 1;
        NSRect actual = self.window.frame;
        GufaLog(@"follow-applied actual=%.0f,%.0f %.0fx%.0f", actual.origin.x, actual.origin.y, actual.size.width, actual.size.height);
    }
}

/* 全局快捷键 ⌃⌥⌘G（四键，避免冲突）：穿透后窗口收不到鼠标事件，靠它切回来（Carbon 热键不需要辅助功能权限） */
- (void)registerToggleHotKey {
    EventTypeSpec spec = {kEventClassKeyboard, kEventHotKeyPressed};
    InstallApplicationEventHandler(NewEventHandlerUPP(GufaHotKeyHandler), 1, &spec, (__bridge void *)self, NULL);
    RegisterEventHotKey(kVK_ANSI_G, controlKey | optionKey | cmdKey, GufaToggleHotKey, GetApplicationEventTarget(), 0, &_hotKeyRef);
}

- (void)toggleClickThrough:(id)sender {
    self.clickThrough = !self.clickThrough;
    self.window.ignoresMouseEvents = self.clickThrough;
    self.statusItem.button.title = self.clickThrough ? @"古法·穿透" : @"古法";
}

- (void)resetFrame:(id)sender {
    NSRect visible = NSScreen.mainScreen.visibleFrame;
    CGFloat width = MIN(1180, visible.size.width * 0.86);
    CGFloat height = MIN(820, visible.size.height * 0.86);
    NSRect frame = NSMakeRect(visible.origin.x + (visible.size.width - width) / 2.0,
                              visible.origin.y + (visible.size.height - height) / 2.0,
                              width, height);
    [self.window setFrame:frame display:YES];
    [self saveFrame];
}

/* 退出摸鱼：恢复主窗口（DeepSeek Harness）到前台，然后关掉悬浮层 */
- (void)exitMoyu:(id)sender {
    [self restoreMainWindow];
    [self stopFollowTimer];
    [self saveFrame];
    [NSApp terminate:nil];
}

- (void)restoreMainWindow {
    GufaSetMainAppHidden(NO);
    GufaActivateBundle(@"com.deepseek.dsh");
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    GufaSetMainAppHidden(NO);
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }

@end

/* SIGTERM（Host 的 float.stop）→ 先恢复主窗口再退出，避免「摸鱼退出后主窗口不在前台」 */
static void GufaInstallTermHandler(void) {
    signal(SIGTERM, SIG_IGN);
    dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler(source, ^{
        GufaSetMainAppHidden(NO);
        GufaActivateBundle(@"com.deepseek.dsh");
        [NSApp terminate:nil];
    });
    dispatch_resume(source);
}

static OSStatus GufaHotKeyHandler(EventHandlerCallRef nextHandler, EventRef event, void *userData) {
    (void)nextHandler;
    (void)event;
    GufaAppDelegate *self = (__bridge GufaAppDelegate *)userData;
    [self toggleClickThrough:nil];
    return noErr;
}

/* ── 窗口枚举：用 Accessibility（辅助功能）API ─────────────────────
 * 不用 CGWindowList（它需要「屏幕录制」，ad-hoc 签名的 helper 拿不到授权）；
 * 辅助功能权限按 responsible app（DeepSeek Harness）继承，用户只需在
 * 「隐私与安全性 → 辅助功能」里勾选 DeepSeek Harness 即可。
 */

static BOOL GufaStringFromAX(AXUIElementRef element, CFStringRef attribute, NSString **out) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || value == NULL) return NO;
    if (CFGetTypeID(value) != CFStringGetTypeID()) { CFRelease(value); return NO; }
    if (out != NULL) *out = (__bridge_transfer NSString *)value;
    else CFRelease(value);
    return YES;
}

static BOOL GufaRectFromAX(AXUIElementRef element, NSRect *out) {
    CFTypeRef posRef = NULL;
    CFTypeRef sizeRef = NULL;
    CGPoint pos = CGPointZero;
    CGSize size = CGSizeZero;
    BOOL ok = NO;
    if (AXUIElementCopyAttributeValue(element, (CFStringRef)CFSTR("AXPosition"), &posRef) == kAXErrorSuccess && posRef != NULL) {
        AXValueGetValue((AXValueRef)posRef, kAXValueCGPointType, &pos);
        CFRelease(posRef);
    }
    if (AXUIElementCopyAttributeValue(element, (CFStringRef)CFSTR("AXSize"), &sizeRef) == kAXErrorSuccess && sizeRef != NULL) {
        AXValueGetValue((AXValueRef)sizeRef, kAXValueCGSizeType, &size);
        CFRelease(sizeRef);
        ok = YES;
    }
    if (out != NULL) *out = NSMakeRect(pos.x, pos.y, size.width, size.height);
    return ok;
}

/** 枚举所有可见窗口，返回 [{pid, owner, title, rect, icon}]。 */
static NSArray<NSDictionary *> *GufaAXWindows(void) {
    NSMutableArray<NSDictionary *> *rows = [NSMutableArray array];
    NSMutableDictionary<NSNumber *, NSData *> *iconCache = [NSMutableDictionary dictionary];
    for (NSRunningApplication *app in [NSWorkspace sharedWorkspace].runningApplications) {
        if (app.activationPolicy != NSApplicationActivationPolicyRegular) continue;
        AXUIElementRef appElement = AXUIElementCreateApplication(app.processIdentifier);
        if (appElement == NULL) continue;
        CFTypeRef winsRef = NULL;
        if (AXUIElementCopyAttributeValue(appElement, (CFStringRef)CFSTR("AXWindows"), &winsRef) == kAXErrorSuccess && winsRef != NULL) {
            NSArray *wins = (__bridge_transfer NSArray *)winsRef;
            for (id win in wins) {
                AXUIElementRef window = (__bridge AXUIElementRef)win;
                NSRect rect = NSZeroRect;
                if (!GufaRectFromAX(window, &rect)) continue;
                if (rect.size.width < 200 || rect.size.height < 140) continue;
                NSString *title = @"";
                GufaStringFromAX(window, (CFStringRef)CFSTR("AXTitle"), &title);
                NSNumber *pidKey = @(app.processIdentifier);
                NSData *iconData = iconCache[pidKey];
                if (iconData == nil) {
                    iconData = NSData.data;
                    NSImage *icon = app.icon;
                    if (icon != nil) {
                        NSImage *resized = [[NSImage alloc] initWithSize:NSMakeSize(32, 32)];
                        [resized lockFocus];
                        [icon drawInRect:NSMakeRect(0, 0, 32, 32) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1.0 respectFlipped:YES hints:nil];
                        [resized unlockFocus];
                        NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithData:resized.TIFFRepresentation];
                        NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
                        if (png != nil) iconData = png;
                    }
                    iconCache[pidKey] = iconData;
                }
                [rows addObject:@{
                    @"pid": pidKey,
                    @"owner": app.localizedName ?: @"",
                    @"title": title,
                    @"x": @(rect.origin.x),
                    @"y": @(rect.origin.y),
                    @"width": @(rect.size.width),
                    @"height": @(rect.size.height),
                    @"icon": [iconData base64EncodedStringWithOptions:0] ?: @"",
                }];
            }
        }
        CFRelease(appElement);
    }
    return rows;
}

/** 枚举运行中的普通 App（不依赖任何权限），按「最前 → 后台」排序。 */
static NSArray<NSDictionary *> *GufaAXApps(void) {
    NSMutableArray<NSDictionary *> *rows = [NSMutableArray array];
    NSRunningApplication *front = [NSWorkspace sharedWorkspace].frontmostApplication;
    CGFloat iconScale = 32.0;
    for (NSRunningApplication *app in [NSWorkspace sharedWorkspace].runningApplications) {
        if (app.activationPolicy != NSApplicationActivationPolicyRegular) continue;
        if (app.bundleIdentifier.length == 0) continue;
        NSData *iconData = NSData.data;
        NSImage *icon = app.icon;
        if (icon != nil) {
            NSImage *resized = [[NSImage alloc] initWithSize:NSMakeSize(iconScale, iconScale)];
            [resized lockFocus];
            [icon drawInRect:NSMakeRect(0, 0, iconScale, iconScale) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1.0 respectFlipped:YES hints:nil];
            [resized unlockFocus];
            NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithData:resized.TIFFRepresentation];
            NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            if (png != nil) iconData = png;
        }
        [rows addObject:@{
            @"pid": @(app.processIdentifier),
            @"bundleId": app.bundleIdentifier,
            @"name": app.localizedName ?: @"",
            @"frontmost": @(front != nil && front.processIdentifier == app.processIdentifier),
            @"icon": [iconData base64EncodedStringWithOptions:0] ?: @"",
        }];
    }
    [rows sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        BOOL fa = [a[@"frontmost"] boolValue];
        BOOL fb = [b[@"frontmost"] boolValue];
        if (fa != fb) return fa ? NSOrderedAscending : NSOrderedDescending;
        return [a[@"name"] localizedCompare:b[@"name"]];
    }];
    return rows;
}

/** 找某个 App 的窗口：优先 focused/main，其次最大的窗口。 */
static AXUIElementRef GufaCopyAppWindow(pid_t pid) {
    AXUIElementRef appElement = AXUIElementCreateApplication(pid);
    if (appElement == NULL) return NULL;
    CFTypeRef windowRef = NULL;
    AXUIElementRef found = NULL;
    if (AXUIElementCopyAttributeValue(appElement, (CFStringRef)CFSTR("AXFocusedWindow"), &windowRef) == kAXErrorSuccess && windowRef != NULL) {
        found = (AXUIElementRef)CFRetain(windowRef);
        CFRelease(windowRef);
    }
    if (found == NULL && AXUIElementCopyAttributeValue(appElement, (CFStringRef)CFSTR("AXMainWindow"), &windowRef) == kAXErrorSuccess && windowRef != NULL) {
        found = (AXUIElementRef)CFRetain(windowRef);
        CFRelease(windowRef);
    }
    if (found == NULL) {
        CFTypeRef winsRef = NULL;
        if (AXUIElementCopyAttributeValue(appElement, (CFStringRef)CFSTR("AXWindows"), &winsRef) == kAXErrorSuccess && winsRef != NULL) {
            NSArray *wins = (__bridge NSArray *)winsRef;
            CGFloat bestArea = 0;
            for (id win in wins) {
                AXUIElementRef window = (__bridge AXUIElementRef)win;
                NSRect rect = NSZeroRect;
                if (!GufaRectFromAX(window, &rect)) continue;
                CGFloat area = rect.size.width * rect.size.height;
                if (area > bestArea && rect.size.width >= 200 && rect.size.height >= 140) {
                    if (found != NULL) CFRelease(found);
                    found = (AXUIElementRef)CFRetain(window);
                    bestArea = area;
                }
            }
            CFRelease(winsRef);
        }
    }
    CFRelease(appElement);
    return found;
}

static BOOL GufaTrustedForAX(void) {
    if (AXIsProcessTrusted()) return YES;
    NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
    AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
    return NO;
}

static void GufaEmitJSON(NSDictionary *out) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:out options:0 error:NULL];
    if (json == nil) return;
    if (GufaOutputPath.length > 0) {
        [json writeToFile:GufaOutputPath atomically:YES];
        return;
    }
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
}

static int GufaListWindowsMode(void) {
    NSArray<NSDictionary *> *rows = GufaAXApps();
    GufaEmitJSON(@{@"ok": @YES, @"apps": rows, @"accessibility": @(GufaTrustedForAX())});
    return 0;
}

/** 隐藏/恢复 DSH 主窗口（AXHidden，等价 ⌘H）。 */
static void GufaSetMainAppHidden(BOOL hidden) {
    NSRunningApplication *app = [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.deepseek.dsh"].firstObject;
    if (app == nil) return;
    AXUIElementRef ax = AXUIElementCreateApplication(app.processIdentifier);
    if (ax == NULL) return;
    AXError error = AXUIElementSetAttributeValue(ax, (CFStringRef)CFSTR("AXHidden"), hidden ? kCFBooleanTrue : kCFBooleanFalse);
    GufaLog(@"main-window-hidden set=%d err=%d", hidden ? 1 : 0, (int)error);
    CFRelease(ax);
}

/** 激活目标 App（LaunchServices open -b，能切到它的 Space）。 */
static void GufaActivateBundle(NSString *bundleId) {
    if (bundleId.length == 0) return;
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/open"];
    task.arguments = @[@"-b", bundleId];
    @try {
        [task launchAndReturnError:NULL];
    } @catch (NSException *exception) {
        /* ignore */
    }
}

static BOOL GufaAXWindowFullScreen(AXUIElementRef window) {
    if (window == NULL) return NO;
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(window, CFSTR("AXFullScreen"), &value) != kAXErrorSuccess || value == NULL) return NO;
    BOOL full = NO;
    if (CFGetTypeID(value) == CFBooleanGetTypeID()) full = CFBooleanGetValue((CFBooleanRef)value);
    CFRelease(value);
    return full;
}

/** 按 pid + title 查找对应 AX window（follow 用）。 */
static AXUIElementRef GufaCopyAXWindow(pid_t pid, NSString *title) {
    AXUIElementRef appElement = AXUIElementCreateApplication(pid);
    if (appElement == NULL) return NULL;
    CFTypeRef winsRef = NULL;
    AXUIElementRef found = NULL;
    if (AXUIElementCopyAttributeValue(appElement, (CFStringRef)CFSTR("AXWindows"), &winsRef) == kAXErrorSuccess && winsRef != NULL) {
        NSArray *wins = (__bridge NSArray *)winsRef;
        for (id win in wins) {
            AXUIElementRef window = (__bridge AXUIElementRef)win;
            NSRect rect = NSZeroRect;
            if (!GufaRectFromAX(window, &rect)) continue;
            NSString *candidateTitle = @"";
            GufaStringFromAX(window, (CFStringRef)CFSTR("AXTitle"), &candidateTitle);
            if (title.length > 0 && ![candidateTitle isEqualToString:title]) continue;
            if (rect.size.width < 200 || rect.size.height < 140) continue;
            found = (AXUIElementRef)CFRetain(window);
            break;
        }
        if (found == NULL && title.length == 0) {
            /* 没标题时退化为第一个够大的窗口 */
            for (id win in wins) {
                AXUIElementRef window = (__bridge AXUIElementRef)win;
                NSRect rect = NSZeroRect;
                if (!GufaRectFromAX(window, &rect)) continue;
                if (rect.size.width < 200 || rect.size.height < 140) continue;
                found = (AXUIElementRef)CFRetain(window);
                break;
            }
        }
        CFRelease(winsRef);
    }
    CFRelease(appElement);
    return found;
}

int main(int argc, const char *argv[]) {
    if (argc > 1 && (strcmp(argv[1], "--version") == 0 || strcmp(argv[1], "-v") == 0)) {
        printf("gufa-float-macos %s\n", GUFA_FLOAT_VERSION);
        return 0;
    }
    if (argc > 1 && (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0)) {
        printf("gufa-float-macos %s\n用法: gufa-float-macos '<payload-json>' | --list-windows --out <path> | --version\n", GUFA_FLOAT_VERSION);
        return 0;
    }
    if (argc > 1 && strcmp(argv[1], "--list-windows") == 0) {
        @autoreleasepool {
            for (int i = 2; i + 1 < argc; i++) {
                if (strcmp(argv[i], "--out") == 0) GufaOutputPath = [NSString stringWithUTF8String:argv[i + 1]];
            }
            return GufaListWindowsMode();
        }
    }
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        GufaInstallTermHandler();
        GufaAppDelegate *delegate = [[GufaAppDelegate alloc] init];
        NSApp.delegate = delegate;
        [NSApp run];
    }
    return 0;
}
