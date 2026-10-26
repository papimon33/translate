package kr.co.kac.airtalk

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * AirTalk 앱 셸 — 현장 폰(호스트 화면) 전용. 첫 실행부터 운영 서버(DEFAULT_URL)로 바로 연다.
 * (손님 태블릿은 웹 브라우저로 접속한다. 관리 메뉴에서 desk 주소를 넣으면 아래 키오스크 동작은 그대로 남아 있다.)
 *
 * 기존 웹앱을 WebView 로 그대로 띄우되(화면은 서버에서 오므로 서버만 고치면 모든 기기가 즉시 갱신),
 * 마이크만 네이티브 AudioRecord(AGC 완전 차단)로 캡처해 `window.AndroidAudio` 브리지로 공급한다.
 * 웹이 할 수 없는 것만 여기서 한다:
 *  - 시작 화면·서버 연결 끊김 화면(서버에 못 붙어도 보여야 하므로 네이티브) + 자동 재연결
 *  - 저장(녹취록 → 저장 위치 선택)·공유 시트·화면 꺼짐 제어 — `window.AndroidApp`
 *  - 뒤로가기: 폰은 웹 화면 뒤로 → 첫 화면에서 두 번 누르면 종료 / 손님 태블릿은 관리 메뉴(키오스크)
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var nativeAudio: NativeAudio
    private lateinit var overlay: LinearLayout
    private lateinit var ovLogo: ImageView
    private lateinit var ovProgress: ProgressBar
    private lateinit var ovTitle: TextView
    private lateinit var ovBody: TextView
    private lateinit var ovStatus: TextView
    private lateinit var ovButtons: LinearLayout
    private val prefs by lazy { getSharedPreferences("airtalk", Context.MODE_PRIVATE) }
    private val main = Handler(Looper.getMainLooper())

    private var loadFailed = false      // 이번 페이지 로드 실패 여부(onPageStarted 에서 초기화)
    private var retryCount = 0
    private var retryAt = 0L
    private var kiosk = false           // 손님 태블릿(desk.html): 몰입 전체화면·화면 상시 켜짐·뒤로가기=관리 메뉴
    private var webKeepOn = false       // 웹이 요청한 화면 켜짐(번역 중에만)
    private var darkUi = false          // 웹 화면이 어두운 테마인지(상태바 색 맞춤)
    private var clearHistoryOnLoad = false
    private var lastBackAt = 0L
    private var backLongPressed = false
    private var pendingSave: String? = null
    @Volatile
    private var updating = false        // 업데이트 내려받는 중(중복 실행 방지)
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    private val retryTick = object : Runnable {
        override fun run() {
            if (!isOfflineShown()) return
            val left = ((retryAt - System.currentTimeMillis() + 999) / 1000).toInt()
            if (left <= 0) {
                retryNow()
                return
            }
            ovStatus.text = "${left}초 후 다시 시도 · ${retryCount}번째"
            main.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)

        webView = WebView(this)
        webView.setBackgroundColor(BG) // 첫 페인트 전 흰 화면 번쩍임 방지
        overlay = buildOverlay()
        val root = FrameLayout(this)
        root.addView(webView, FrameLayout.LayoutParams(MATCH, MATCH))
        root.addView(overlay, FrameLayout.LayoutParams(MATCH, MATCH))
        setContentView(root)
        setupWebView()
        applyBars()
        applyKeepScreen()

        nativeAudio = NativeAudio(this, webView)
        nativeAudio.inputGain = prefs.getFloat("gain", 1.0f)
        webView.addJavascriptInterface(nativeAudio, "AndroidAudio")
        webView.addJavascriptInterface(AppBridge(), "AndroidApp")

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
        }

        showSplash()
        registerNetwork()
        // 앱은 폰 전용(손님 태블릿은 웹 브라우저로 접속) — 첫 실행부터 운영 서버로 바로 연다
        webView.loadUrl(serverUrl())
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // 데스크 뷰어·TTS 는 사용자 제스처 없이도 소리를 내야 한다(호스트가 원격으로 응대 시작)
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString AirTalkApp/1.1"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        // 현장 문제를 PC 크롬 chrome://inspect 로 바로 들여다볼 수 있게 항상 허용(내부 운영 앱)
        WebView.setWebContentsDebuggingEnabled(true)

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                // 페이지 이동/새로고침 시 진행 중이던 네이티브 캡처를 반드시 끊는다 —
                // 웹 쪽 핸들러(window.__kacNA)가 사라진 채 마이크만 계속 도는 것을 방지
                nativeAudio.stop()
                loadFailed = false
                updateMode(url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (loadFailed) return // 실패한 로드의 오류 페이지 — 연결 끊김 화면 유지
                retryCount = 0
                // 시작 화면은 웹이 첫 화면을 다 그린 뒤 AndroidApp.ready() 로 닫는다(페이지 다운로드 끝 ≠ 화면 준비).
                // 웹 오류 등으로 신호가 안 오면 SPLASH_MAX_MS 뒤 닫는다(로고에 갇히지 않게).
                main.removeCallbacks(splashTimeout)
                main.postDelayed(splashTimeout, SPLASH_MAX_MS)
                if (clearHistoryOnLoad) {
                    clearHistoryOnLoad = false
                    webView.clearHistory() // 서버 주소를 바꾼 뒤 뒤로가기로 옛 서버가 열리지 않게
                }
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame != true) return
                Log.w(TAG, "main frame error ${error?.errorCode} ${error?.description}")
                loadFailed = true
                showOffline()
            }

            override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
                // 서버 오류(5xx: 배포 중·무료 플랜 기동 대기 등)도 오류 페이지 대신 연결 끊김 화면 + 자동 재시도
                if (request?.isForMainFrame != true || (errorResponse?.statusCode ?: 0) < 500) return
                loadFailed = true
                showOffline()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // WebView 렌더러 크래시 → 액티비티 재생성으로 복구(빈 화면 방치 방지)
                Log.w(TAG, "render process gone (crashed=${detail.didCrash()})")
                nativeAudio.stop()
                recreate()
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                // 네이티브 브리지 대신 웹 getUserMedia 로 도는 경로(폴백)도 동작하게 마이크만 승인
                runOnUiThread {
                    val grant = request.resources.filter {
                        it == PermissionRequest.RESOURCE_AUDIO_CAPTURE &&
                            checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                    }
                    if (grant.isEmpty()) request.deny() else request.grant(grant.toTypedArray())
                }
            }

            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d(TAG, "[web] ${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})")
                return true
            }
        }

        // APK 등 파일 다운로드는 외부 브라우저로 넘긴다(WebView 는 다운로드 미지원)
        webView.setDownloadListener { url, _, _, _, _ ->
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (_: Exception) {
            }
        }
    }

    /* ---- 웹 브리지(window.AndroidApp): 웹이 못 하는 저장·공유·화면 제어 ---- */
    inner class AppBridge {
        @JavascriptInterface
        fun version(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        } catch (_: Exception) {
            ""
        }

        /** 웹이 첫 화면(로그인·홈)을 다 그렸다 — 시작 화면(또는 재연결 화면)을 닫는다 */
        @JavascriptInterface
        fun ready() {
            runOnUiThread { if (!loadFailed) hideOverlay() }
        }

        @JavascriptInterface
        fun openMenu() {
            runOnUiThread { showMenu() }
        }

        /** 번역 중에만 화면 켜짐(폰 배터리) — 손님 태블릿은 항상 켜짐 */
        @JavascriptInterface
        fun setKeepScreenOn(on: Boolean) {
            runOnUiThread {
                webKeepOn = on
                applyKeepScreen()
            }
        }

        @JavascriptInterface
        fun setDarkUi(dark: Boolean) {
            runOnUiThread {
                if (darkUi != dark) {
                    darkUi = dark
                    applyBars()
                }
            }
        }

        @JavascriptInterface
        fun shareText(text: String) {
            runOnUiThread {
                try {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, text)
                    }
                    startActivity(Intent.createChooser(send, "링크 공유"))
                } catch (_: Exception) {
                }
            }
        }

        /**
         * 앱 업데이트: path(서버 상대 경로, 예 /download/desktop?platform=android)의 APK 를 내려받아 설치 화면을 연다.
         * 진행률은 window.__kacUpd(0~100) 로, 실패는 -1, 설치 화면을 띄우면 101.
         */
        @JavascriptInterface
        fun installUpdate(path: String) {
            runOnUiThread { startUpdate(path) }
        }

        /** 녹취록 저장 — WebView 는 blob 다운로드를 못 하므로 안드로이드 '저장 위치 선택' 창으로 */
        @JavascriptInterface
        fun saveText(name: String, text: String) {
            runOnUiThread {
                pendingSave = text
                try {
                    val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TITLE, name)
                    }
                    startActivityForResult(i, REQ_SAVE)
                } catch (_: Exception) {
                    pendingSave = null
                    Toast.makeText(this@MainActivity, "이 기기에서는 파일로 저장할 수 없습니다", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_SAVE) return
        val text = pendingSave
        pendingSave = null
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null || text == null) return
        try {
            contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
            Toast.makeText(this, "녹취록을 저장했습니다", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Log.w(TAG, "save failed", e)
            Toast.makeText(this, "저장하지 못했습니다", Toast.LENGTH_SHORT).show()
        }
    }

    /* ---- 앱 안 업데이트 ---- */
    private fun notifyUpdate(pct: Int) {
        main.post { webView.evaluateJavascript("window.__kacUpd&&window.__kacUpd($pct)", null) }
    }

    private fun startUpdate(path: String) {
        if (updating) return
        val abs = try {
            URL(URL(webView.url ?: serverUrl()), path).toString()
        } catch (_: Exception) {
            notifyUpdate(-1)
            return
        }
        // 다운로드 경로는 로그인이 필요하다 — WebView 의 로그인 쿠키를 우리 서버 요청에만 싣는다
        val cookie = CookieManager.getInstance().getCookie(abs)
        updating = true
        Thread({ downloadUpdate(abs, cookie) }, "airtalk-update").start()
    }

    private fun downloadUpdate(abs: String, cookie: String?) {
        try {
            val out = UpdateFileProvider.updateApkFile(cacheDir)
            out.parentFile?.mkdirs()
            out.delete()
            val conn = openFollowingRedirects(abs, cookie)
            val total = conn.contentLengthLong
            var done = 0L
            var lastPct = -1
            conn.inputStream.use { input ->
                FileOutputStream(out).use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        done += n
                        if (total > 0) {
                            val pct = (done * 100 / total).toInt().coerceIn(0, 100)
                            if (pct != lastPct) {
                                lastPct = pct
                                notifyUpdate(pct)
                            }
                        }
                    }
                }
            }
            conn.disconnect()
            if (out.length() < 100_000) throw IOException("file too small (${out.length()})") // 로그인 페이지 등 오응답 방어
            notifyUpdate(100)
            main.post { launchInstaller() }
        } catch (e: Exception) {
            Log.w(TAG, "update download failed", e)
            notifyUpdate(-1)
            main.post { Toast.makeText(this, "업데이트를 내려받지 못했습니다", Toast.LENGTH_SHORT).show() }
        } finally {
            updating = false
        }
    }

    /** 리다이렉트를 직접 따라간다 — 로그인 쿠키는 처음 요청한 우리 서버(host)에만 싣고 GitHub 등 외부로는 보내지 않는다 */
    private fun openFollowingRedirects(abs: String, cookie: String?): HttpURLConnection {
        val home = URL(abs).host
        var url = URL(abs)
        repeat(6) {
            val conn = url.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            if (cookie != null && url.host == home) conn.setRequestProperty("Cookie", cookie)
            val code = conn.responseCode
            if (code in 300..399) {
                val loc = conn.getHeaderField("Location")
                conn.disconnect()
                if (loc.isNullOrBlank()) throw IOException("redirect without location")
                url = URL(url, loc)
                return@repeat
            }
            if (code != 200) {
                conn.disconnect()
                throw IOException("HTTP $code")
            }
            return conn
        }
        throw IOException("too many redirects")
    }

    private fun launchInstaller() {
        try {
            val i = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(UpdateFileProvider.contentUri(packageName), UpdateFileProvider.APK_MIME)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            // 처음 한 번은 안드로이드가 'AirTalk 에서 앱 설치 허용' 설정으로 안내한다(시스템 동작)
            startActivity(i)
            notifyUpdate(101)
        } catch (e: Exception) {
            Log.w(TAG, "installer launch failed", e)
            notifyUpdate(-1)
            Toast.makeText(this, "설치 화면을 열지 못했습니다", Toast.LENGTH_SHORT).show()
        }
    }

    /* ---- 시작 화면 · 연결 끊김 화면(네이티브) ---- */
    private fun dp(v: Float): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()

    private fun lp(w: Int, h: Int, top: Int = 0) = LinearLayout.LayoutParams(w, h).apply { topMargin = top }

    private fun pillButton(label: String, filled: Boolean, onClick: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        setTypeface(typeface, Typeface.BOLD)
        stateListAnimator = null
        setTextColor(if (filled) Color.WHITE else INK)
        background = GradientDrawable().apply {
            cornerRadius = dp(16f).toFloat()
            setColor(if (filled) INK else Color.TRANSPARENT)
        }
        setOnClickListener { onClick() }
    }

    private fun buildOverlay(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32f), dp(32f), dp(32f), dp(32f))
            setBackgroundColor(BG)
            isClickable = true // 아래 WebView 로 터치가 새지 않게
        }
        // 시작 화면 = 흰 바탕 가운데 글자 로고 'airtalk.'만(웹 홈 제목과 같은 Nunito 그림). 연결 실패 화면은 아래 진행 표시·문구·버튼.
        ovLogo = ImageView(this).apply {
            setImageResource(R.drawable.splash_wordmark)
            adjustViewBounds = true
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "AirTalk"
        }
        ovProgress = ProgressBar(this).apply { isIndeterminate = true }
        ovTitle = TextView(this).apply {
            textSize = 22f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(INK)
            gravity = Gravity.CENTER
        }
        ovBody = TextView(this).apply {
            textSize = 15f
            setTextColor(MUTED)
            gravity = Gravity.CENTER
            setLineSpacing(0f, 1.35f)
        }
        ovStatus = TextView(this).apply {
            textSize = 13f
            setTextColor(MUTED)
            gravity = Gravity.CENTER
        }
        ovButtons = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(pillButton("지금 다시 시도", filled = true) { retryNow() }, lp(MATCH, dp(56f)))
            addView(pillButton("서버 주소 확인", filled = false) { askUrl() }, lp(MATCH, dp(48f), dp(8f)))
        }
        box.addView(ovLogo, lp(dp(160f), WRAP))
        box.addView(ovProgress, lp(dp(36f), dp(36f)))
        box.addView(ovTitle, lp(MATCH, WRAP, dp(20f)))
        box.addView(ovBody, lp(MATCH, WRAP, dp(10f)))
        box.addView(ovStatus, lp(MATCH, WRAP, dp(14f)))
        box.addView(ovButtons, lp(MATCH, WRAP, dp(36f)))
        return box
    }

    private fun showSplash() {
        setOverlayMode(splash = true)
        ovButtons.visibility = View.GONE
        overlay.visibility = View.VISIBLE
    }

    // 시작 화면(로고만) ↔ 연결 실패 화면(진행 표시·문구·버튼)
    private fun setOverlayMode(splash: Boolean) {
        ovLogo.visibility = if (splash) View.VISIBLE else View.GONE
        val rest = if (splash) View.GONE else View.VISIBLE
        ovProgress.visibility = rest
        ovTitle.visibility = rest
        ovBody.visibility = rest
        ovStatus.visibility = rest
    }

    private fun showOffline() {
        main.removeCallbacks(splashTimeout)
        setOverlayMode(splash = false)
        ovTitle.text = "서버에 다시 연결하는 중"
        ovBody.text = "네트워크가 돌아오면 자동으로 다시 연결합니다.\n확정된 대화는 서버에 저장돼 있어 사라지지 않습니다."
        ovButtons.visibility = View.VISIBLE
        overlay.visibility = View.VISIBLE
        retryCount++
        val delay = RETRY_SEC[minOf(retryCount - 1, RETRY_SEC.size - 1)]
        retryAt = System.currentTimeMillis() + delay * 1000L
        main.removeCallbacks(retryTick)
        main.post(retryTick)
    }

    private val splashTimeout = Runnable { hideOverlay() }

    private fun hideOverlay() {
        main.removeCallbacks(retryTick)
        main.removeCallbacks(splashTimeout)
        overlay.visibility = View.GONE
    }

    private fun isOfflineShown() = overlay.visibility == View.VISIBLE && ovButtons.visibility == View.VISIBLE

    private fun retryNow() {
        main.removeCallbacks(retryTick)
        ovStatus.text = "연결하는 중…"
        val u = webView.url
        if (u.isNullOrBlank() || u == "about:blank" || u.startsWith("data:")) {
            webView.loadUrl(serverUrl())
        } else {
            webView.reload()
        }
    }

    /** 네트워크가 돌아오면 다음 재시도까지 기다리지 않고 바로 연결 */
    private fun registerNetwork() {
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    main.post { if (isOfflineShown()) retryNow() }
                }
            }
            cm.registerDefaultNetworkCallback(cb)
            netCallback = cb
        } catch (_: Exception) {
        }
    }

    /* ---- 화면 모드: 손님 태블릿(키오스크) vs 폰 ---- */
    private fun updateMode(url: String?) {
        // 경로로만 판정(도메인에 desk 가 들어간 서버 주소를 키오스크로 오인하지 않게)
        val path = try {
            Uri.parse(url ?: "").path ?: ""
        } catch (_: Exception) {
            ""
        }
        val k = path.contains("desk", ignoreCase = true)
        if (k == kiosk) return
        kiosk = k
        applyBars()
        applyKeepScreen()
    }

    @Suppress("DEPRECATION")
    private fun applyBars() {
        if (kiosk) {
            hideSystemBars()
            return
        }
        // 폰: 상태바·내비게이션바를 앱 배경색으로(몰입 전체화면은 손님 태블릿만)
        val bg = if (darkUi) BG_DARK else BG
        window.statusBarColor = bg
        window.navigationBarColor = bg
        var flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        if (!darkUi) flags = flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        window.decorView.systemUiVisibility = flags
        webView.setBackgroundColor(bg)
    }

    private fun applyKeepScreen() {
        // 손님 태블릿은 상시 화면(꺼지면 터치 화면이 사라진다), 폰은 번역 중에만
        if (kiosk || webKeepOn) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    /* ---- 몰입 전체화면(키오스크): 시스템 바 숨김, 가장자리 스와이프로 일시 노출 ---- */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && kiosk) hideSystemBars()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
    }

    /* ---- 뒤로가기 ----
     * 손님 태블릿: 관리 메뉴(웹 히스토리로 손님이 화면을 벗어나지 않게).
     * 폰: 웹 화면 뒤로(세션 → 홈), 첫 화면에서는 두 번 누르면 종료. 길게 누르면 언제든 관리 메뉴. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            event?.startTracking()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyLongPress(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            backLongPressed = true
            showMenu()
            return true
        }
        return super.onKeyLongPress(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (backLongPressed || event?.isCanceled == true) {
                backLongPressed = false
                return true
            }
            handleBack()
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    private fun handleBack() {
        if (kiosk) {
            showMenu()
            return
        }
        if (overlay.visibility != View.VISIBLE && webView.canGoBack()) {
            webView.goBack()
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastBackAt < 2000) {
            finish()
            return
        }
        lastBackAt = now
        Toast.makeText(this, "한 번 더 누르면 종료됩니다", Toast.LENGTH_SHORT).show()
    }

    private fun showMenu() {
        val items = arrayOf("새로고침", "서버 주소 변경", "마이크 입력 게인", "앱 정보")
        AlertDialog.Builder(this)
            .setTitle("AirTalk 관리")
            .setItems(items) { _, i ->
                when (i) {
                    0 -> webView.reload()
                    1 -> askUrl()
                    2 -> askGain()
                    3 -> showInfo()
                }
            }
            .setNegativeButton("닫기", null)
            .show()
    }

    /** 접속할 서버 — 관리 메뉴에서 바꾼 주소가 없으면 운영 서버 */
    private fun serverUrl(): String = prefs.getString("url", null)?.takeIf { it.isNotBlank() } ?: DEFAULT_URL

    private fun askUrl() {
        val input = EditText(this).apply {
            hint = DEFAULT_URL
            setText(serverUrl())
        }
        val wrap = LinearLayout(this).apply {
            setPadding(48, 24, 48, 0)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        val b = AlertDialog.Builder(this)
            .setTitle("서버 주소")
            .setMessage("평소에는 바꿀 필요가 없습니다(기본: 운영 서버). 시험 서버에 붙일 때만 바꾸고, 비우고 저장하면 기본 주소로 돌아갑니다.")
            .setView(wrap)
            .setPositiveButton("저장") { _, _ ->
                var u = input.text.toString().trim()
                if (u.isEmpty() || u == DEFAULT_URL) {
                    prefs.edit().remove("url").apply()
                    u = DEFAULT_URL
                } else {
                    if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://$u"
                    prefs.edit().putString("url", u).apply()
                }
                retryCount = 0
                clearHistoryOnLoad = true
                showSplash()
                webView.loadUrl(u)
            }
        b.setNegativeButton("취소", null)
        b.show()
    }

    private fun askGain() {
        val cur = prefs.getFloat("gain", 1.0f)
        val label = TextView(this).apply { textSize = 16f }
        val seek = SeekBar(this).apply {
            max = 79 // progress+1 → 0.1×~8.0×
            progress = ((cur * 10).toInt() - 1).coerceIn(0, 79)
        }
        fun fmt(p: Int) = "×%.1f".format((p + 1) / 10f)
        label.text = "마이크 입력 게인: ${fmt(seek.progress)}"
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: SeekBar?, p: Int, fromUser: Boolean) {
                label.text = "마이크 입력 게인: ${fmt(p)}"
            }
            override fun onStartTrackingTouch(s: SeekBar?) {}
            override fun onStopTrackingTouch(s: SeekBar?) {}
        })
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
            addView(label)
            addView(seek)
        }
        AlertDialog.Builder(this)
            .setTitle("마이크 입력 게인")
            .setMessage("이 앱은 자동 증폭(AGC) 없이 원음 그대로 인식합니다. 소리가 너무 작거나 크면 여기서 보정하세요. 기본 ×1.0")
            .setView(wrap)
            .setPositiveButton("적용") { _, _ ->
                val g = (seek.progress + 1) / 10f
                prefs.edit().putFloat("gain", g).apply()
                nativeAudio.inputGain = g
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun showInfo() {
        val ver = try {
            packageManager.getPackageInfo(packageName, 0).versionName
        } catch (_: Exception) {
            "?"
        }
        AlertDialog.Builder(this)
            .setTitle("AirTalk $ver")
            .setMessage(
                "서버: ${serverUrl()}\n" +
                    "마이크 입력: ${nativeAudio.inputStatus()}\n" +
                    "마이크 게인: ×${prefs.getFloat("gain", 1.0f)}\n" +
                    "오디오: ${nativeAudio.info()}\n\n" +
                    "네이티브 마이크(AGC 차단)로 캡처합니다. 문제 시 PC 크롬 chrome://inspect 로 원격 점검할 수 있습니다."
            )
            .setPositiveButton("확인", null)
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            // 권한 승인 전에 시작 실패한 페이지가 다시 시도하도록 새로고침
            webView.reload()
        }
    }

    override fun onDestroy() {
        nativeAudio.stop()
        main.removeCallbacks(retryTick)
        netCallback?.let {
            try {
                (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it)
            } catch (_: Exception) {
            }
        }
        try {
            webView.destroy()
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "AirTalk"
        private const val REQ_MIC = 1
        private const val REQ_SAVE = 2
        private const val DEFAULT_URL = "https://translate-voxm.onrender.com" // 운영 서버(데스크톱 앱 기본값과 동일)
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
        private val RETRY_SEC = intArrayOf(2, 4, 8, 15)
        private const val SPLASH_MAX_MS = 6000L // 웹 '준비 완료'를 기다리는 최대 시간(페이지 다운로드 끝난 뒤부터)
        private val BG = Color.parseColor("#FFFFFF") // 폰 화면 바탕(순백, 2026-10-26)
        private val BG_DARK = Color.parseColor("#1F1E1D")
        private val INK = Color.parseColor("#1F1E1D")
        private val MUTED = Color.parseColor("#6B6A63")
    }
}
