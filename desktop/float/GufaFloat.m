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
#import <CoreGraphics/CoreGraphics.h>
#import <Carbon/Carbon.h>

static const EventHotKeyID GufaToggleHotKey = {'gufa', 1};

@class GufaAppDelegate;

static OSStatus GufaHotKeyHandler(EventHandlerCallRef nextHandler, EventRef event, void *userData);

@interface GufaDragStrip : NSView
@property (nonatomic, weak) id doubleClickTarget;
@property (nonatomic, assign) SEL doubleClickAction;
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
    NSString *label = @"古法编程 · 悬浮层（拖动移动 · 双击穿透 · 右键菜单 · ⌥⌘G 切穿透）";
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
    if (event.clickCount == 2 && self.doubleClickTarget != nil && self.doubleClickAction != NULL) {
        [NSApp sendAction:self.doubleClickAction to:self.doubleClickTarget from:self];
        return;
    }
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
@property (nonatomic, assign) BOOL clickThrough;
@property (nonatomic, strong) NSString *frameKey;
@property (nonatomic, strong) GufaNavigationDelegate *navigation;
@property (nonatomic, strong) NSDictionary *options;
@property (nonatomic, assign) EventHotKeyRef hotKeyRef;
@property (nonatomic, assign) BOOL following;
@property (nonatomic, assign) int followWindowNumber;
@property (nonatomic, assign) pid_t followOwnerPID;
@property (nonatomic, strong) NSTimer *followTimer;
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *windowCandidates;
- (void)loadWebContent;
- (void)registerToggleHotKey;
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
    [self buildWindow];
    [self buildStatusItem];
    [self registerToggleHotKey];
    [self loadWebContent];
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

    self.window = [[NSWindow alloc] initWithContentRect:frame
                                             styleMask:(NSWindowStyleMaskBorderless | NSWindowStyleMaskResizable)
                                               backing:NSBackingStoreBuffered
                                                 defer:NO];
    self.window.opaque = NO;
    self.window.backgroundColor = NSColor.clearColor;
    self.window.hasShadow = YES;
    self.window.level = NSFloatingWindowLevel + 1;
    self.window.collectionBehavior = (NSWindowCollectionBehaviorCanJoinAllSpaces
                                      | NSWindowCollectionBehaviorFullScreenAuxiliary
                                      | NSWindowCollectionBehaviorStationary);
    self.window.minSize = NSMakeSize(520, 360);
    self.window.title = @"古法编程悬浮层";

    NSView *container = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
    container.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    container.wantsLayer = YES;

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
    /* URL query 可能被 DSH 的浏览器端路由吞掉，这里在文档开始前写一个标记，客户端据此进入悬浮模式 */
    WKUserScript *floatMarker = [[WKUserScript alloc] initWithSource:@"try{localStorage.setItem('gufa-code:float','1')}catch(e){}"
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
    strip.doubleClickTarget = self;
    strip.doubleClickAction = @selector(toggleClickThrough:);
    [container addSubview:strip];
    self.dragStrip = strip;

    self.window.contentView = container;
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(saveFrame) name:NSWindowDidEndLiveResizeNotification object:self.window];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(saveFrame) name:NSWindowDidMoveNotification object:self.window];
}

- (void)buildStatusItem {
    self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
    self.statusItem.button.title = @"古法";
    self.statusItem.button.toolTip = @"古法编程悬浮层";
    NSMenu *menu = [[NSMenu alloc] init];
    [menu addItemWithTitle:@"跟随 App 窗口…（需屏幕录制权限）" action:@selector(chooseFollowWindow:) keyEquivalent:@""].target = self;
    [menu addItemWithTitle:@"停止跟随" action:@selector(stopFollow:) keyEquivalent:@""].target = self;
    [menu addItem:[NSMenuItem separatorItem]];
    [menu addItemWithTitle:@"切换点击穿透（⌥⌘G）" action:@selector(toggleClickThrough:) keyEquivalent:@""].target = self;
    [menu addItemWithTitle:@"重置窗口位置和大小" action:@selector(resetFrame:) keyEquivalent:@""].target = self;
    [menu addItem:[NSMenuItem separatorItem]];
    [menu addItemWithTitle:@"关闭悬浮层" action:@selector(quitApp:) keyEquivalent:@""].target = self;
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
        NSURLComponents *components = [NSURLComponents componentsWithString:appUrl];
        components.queryItems = @[[NSURLQueryItem queryItemWithName:@"gufa-float" value:@"1"]];
        NSURL *clean = components.URL;
        if (clean != nil && ![clean.absoluteString isEqualToString:self.webView.URL.absoluteString]) {
            [self.webView loadRequest:[NSURLRequest requestWithURL:clean]];
        }
    };
    [self.webView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:authUrl]]];
}

- (void)saveFrame {
    if (self.window == nil) return;
    [[NSUserDefaults standardUserDefaults] setObject:NSStringFromRect(self.window.frame) forKey:self.frameKey];
}

/* ── P1：跟随选中的 App 窗口 ───────────────────────────────────── */

/** 枚举屏幕上的普通窗口（需要屏幕录制权限才能看到别的 App）。 */
- (NSArray<NSDictionary *> *)visibleWindows {
    NSMutableArray<NSDictionary *> *rows = [NSMutableArray array];
    CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (list == NULL) return rows;
    NSInteger count = CFArrayGetCount(list);
    pid_t selfPid = NSProcessInfo.processInfo.processIdentifier;
    for (NSInteger i = 0; i < count && rows.count < 60; i++) {
        NSDictionary *info = (__bridge NSDictionary *)CFArrayGetValueAtIndex(list, i);
        NSNumber *layer = info[(id)kCGWindowLayer];
        if (![layer isKindOfClass:[NSNumber class]] || layer.intValue != 0) continue;
        NSNumber *pid = info[(id)kCGWindowOwnerPID];
        if (![pid isKindOfClass:[NSNumber class]] || pid.intValue == selfPid) continue;
        NSNumber *number = info[(id)kCGWindowNumber];
        NSDictionary *bounds = info[(id)kCGWindowBounds];
        if (number == nil || bounds == nil) continue;
        CGRect rect = CGRectZero;
        if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)bounds, &rect)) continue;
        if (rect.size.width < 220 || rect.size.height < 160) continue;
        NSString *owner = info[(id)kCGWindowOwnerName];
        NSString *title = info[(id)kCGWindowName];
        NSString *label = [NSString stringWithFormat:@"%@%@  ·  %.0f×%.0f",
                           owner != nil ? owner : @"?",
                           (title.length > 0 ? [NSString stringWithFormat:@" — %@", title] : @""),
                           rect.size.width, rect.size.height];
        [rows addObject:@{
            @"number": number,
            @"pid": pid,
            @"owner": owner != nil ? owner : @"?",
            @"title": title != nil ? title : @"",
            @"label": label,
            @"rect": NSStringFromRect(NSRectFromCGRect(rect)),
        }];
    }
    CFRelease(list);
    return rows;
}

- (void)showPermissionGuide {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"需要「屏幕录制」权限";
    alert.informativeText = @"要跟随其他 App 的窗口大小，系统需要授予本悬浮层「屏幕录制」权限：\n\n系统设置 → 隐私与安全性 → 屏幕录制 → 勾选「古法编程悬浮层 / gufa-float」；授权后点「重试」。\n\n（只读取窗口尺寸，不录屏、不采集画面。）";
    [alert addButtonWithTitle:@"打开系统设置"];
    [alert addButtonWithTitle:@"取消"];
    NSModalResponse response = [alert runModal];
    if (response == NSAlertFirstButtonReturn) {
        [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"]];
    }
}

- (void)chooseFollowWindow:(id)sender {
    if (!CGPreflightScreenCaptureAccess()) {
        CGRequestScreenCaptureAccess();
        [self showPermissionGuide];
        return;
    }
    NSArray<NSDictionary *> *rows = [self visibleWindows];
    /* 只有一个窗口 = 权限没生效，仍是我们自己 */
    if (rows.count == 0) {
        [self showPermissionGuide];
        return;
    }
    self.windowCandidates = [rows mutableCopy];

    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"选择要跟随的 App 窗口";
    alert.informativeText = @"悬浮层会保持与该窗口相同的位置和大小；窗口移动/缩放时自动跟随。";
    NSPopUpButton *popup = [[NSPopUpButton alloc] initWithFrame:NSMakeRect(0, 0, 420, 26) pullsDown:NO];
    for (NSDictionary *row in self.windowCandidates) {
        [popup addItemWithTitle:row[@"label"]];
    }
    alert.accessoryView = popup;
    [alert addButtonWithTitle:@"开始跟随"];
    [alert addButtonWithTitle:@"取消"];
    if ([alert runModal] != NSAlertFirstButtonReturn) return;
    NSInteger index = popup.indexOfSelectedItem;
    if (index < 0 || index >= (NSInteger)self.windowCandidates.count) return;
    NSDictionary *row = self.windowCandidates[(NSUInteger)index];
    self.followWindowNumber = [row[@"number"] intValue];
    self.followOwnerPID = (pid_t)[row[@"pid"] intValue];
    self.following = YES;
    [self startFollowTimer];
    [self applyFollowFrame];
    self.statusItem.button.title = @"古法·跟随";
}

- (void)stopFollow:(id)sender {
    [self stopFollowTimer];
    self.statusItem.button.title = self.clickThrough ? @"古法·穿透" : @"古法";
}

- (void)startFollowTimer {
    [self stopFollowTimer];
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
}

/** 找到被跟随窗口当前 bounds，把悬浮窗贴上去（主屏坐标换算；多屏后续再完善）。 */
- (void)applyFollowFrame {
    if (!self.following || self.followWindowNumber == 0) return;
    CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (list == NULL) return;
    CGRect target = CGRectZero;
    BOOL found = NO;
    NSInteger count = CFArrayGetCount(list);
    for (NSInteger i = 0; i < count; i++) {
        NSDictionary *info = (__bridge NSDictionary *)CFArrayGetValueAtIndex(list, i);
        NSNumber *number = info[(id)kCGWindowNumber];
        if (![number isKindOfClass:[NSNumber class]] || number.intValue != self.followWindowNumber) continue;
        NSNumber *pid = info[(id)kCGWindowOwnerPID];
        if (![pid isKindOfClass:[NSNumber class]] || pid.intValue != self.followOwnerPID) continue;
        NSDictionary *bounds = info[(id)kCGWindowBounds];
        if (bounds != nil && CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)bounds, &target)) found = YES;
        break;
    }
    CFRelease(list);
    if (!found) {
        /* 目标窗口关闭：停止跟随，保持当前位置 */
        [self stopFollowTimer];
        self.statusItem.button.title = @"古法";
        return;
    }
    CGFloat screenHeight = NSScreen.mainScreen.frame.size.height;
    NSRect frame = NSMakeRect(target.origin.x, screenHeight - target.origin.y - target.size.height, target.size.width, target.size.height);
    [self.window setFrame:frame display:YES animate:NO];
    [self saveFrame];
}

/* 全局快捷键 ⌥⌘G：穿透后窗口收不到鼠标事件，靠它切回来（Carbon 热键不需要辅助功能权限） */
- (void)registerToggleHotKey {
    EventTypeSpec spec = {kEventClassKeyboard, kEventHotKeyPressed};
    InstallApplicationEventHandler(NewEventHandlerUPP(GufaHotKeyHandler), 1, &spec, (__bridge void *)self, NULL);
    RegisterEventHotKey(kVK_ANSI_G, cmdKey | optionKey, GufaToggleHotKey, GetApplicationEventTarget(), 0, &_hotKeyRef);
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

- (void)quitApp:(id)sender {
    [self stopFollowTimer];
    [self saveFrame];
    [NSApp terminate:nil];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }

@end

static OSStatus GufaHotKeyHandler(EventHandlerCallRef nextHandler, EventRef event, void *userData) {
    (void)nextHandler;
    (void)event;
    GufaAppDelegate *self = (__bridge GufaAppDelegate *)userData;
    [self toggleClickThrough:nil];
    return noErr;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        GufaAppDelegate *delegate = [[GufaAppDelegate alloc] init];
        NSApp.delegate = delegate;
        [NSApp run];
    }
    return 0;
}
