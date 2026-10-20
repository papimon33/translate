package kr.co.kac.airtalk

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File

/**
 * 내려받은 업데이트 APK 한 개를 안드로이드 설치 화면에 건네는 최소 ContentProvider.
 * (API 24+ 는 file:// 를 다른 앱에 넘길 수 없다. androidx FileProvider 의존성을 들이지 않으려고 직접 둔다)
 * 읽기 전용, exported=false — 설치 화면은 인텐트의 일시 읽기 권한(FLAG_GRANT_READ_URI_PERMISSION)으로만 연다.
 */
class UpdateFileProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    private fun apk(): File = updateApkFile(context!!.cacheDir)

    override fun getType(uri: Uri): String = APK_MIME

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
        ParcelFileDescriptor.open(apk(), ParcelFileDescriptor.MODE_READ_ONLY)

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor {
        val f = apk()
        return MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)).apply {
            addRow(arrayOf<Any>(f.name, f.length()))
        }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

    companion object {
        const val APK_MIME = "application/vnd.android.package-archive"

        fun updateApkFile(cacheDir: File): File = File(File(cacheDir, "updates"), "AirTalk-update.apk")

        fun contentUri(packageName: String): Uri = Uri.parse("content://$packageName.update/AirTalk-update.apk")
    }
}
