package com.senevon.games;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import androidx.annotation.NonNull;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Colours the strips behind the status bar and the navigation bar to match the page.
 * Android 15+ is always edge-to-edge, so StatusBar.setBackgroundColor does nothing there: the
 * WebView is padded below the bars and the window background shows through. This paints that
 * background: the top half in the page's top colour, the bottom half in its bottom colour, and
 * picks dark or light bar icons for each (Capacitor's SystemBars.setStyle would reset the
 * background, so it is not used for this).
 */
@CapacitorPlugin(name = "Bars")
public class BarsPlugin extends Plugin {

    private static class SplitDrawable extends Drawable {
        private final Paint top = new Paint();
        private final Paint bottom = new Paint();

        SplitDrawable(int topColor, int bottomColor) {
            top.setColor(topColor);
            bottom.setColor(bottomColor);
        }

        @Override
        public void draw(@NonNull Canvas canvas) {
            Rect b = getBounds();
            int mid = b.top + b.height() / 2;
            canvas.drawRect(b.left, b.top, b.right, mid, top);
            canvas.drawRect(b.left, mid, b.right, b.bottom, bottom);
        }

        @Override
        public void setAlpha(int alpha) {}

        @Override
        public void setColorFilter(ColorFilter colorFilter) {}

        @Override
        public int getOpacity() {
            return PixelFormat.OPAQUE;
        }
    }

    @PluginMethod
    public void setColors(PluginCall call) {
        int topColor;
        int bottomColor;
        try {
            topColor = Color.parseColor(call.getString("top", "#121212"));
            bottomColor = Color.parseColor(call.getString("bottom", call.getString("top", "#121212")));
        } catch (IllegalArgumentException e) {
            call.reject("bad_color");
            return;
        }
        boolean darkTopIcons = call.getBoolean("darkTopIcons", false);
        boolean darkBottomIcons = call.getBoolean("darkBottomIcons", false);
        getActivity().runOnUiThread(() -> {
            android.view.Window window = getActivity().getWindow();
            window.setBackgroundDrawable(new SplitDrawable(topColor, bottomColor));
            WindowInsetsControllerCompat icons = WindowCompat.getInsetsController(window, window.getDecorView());
            icons.setAppearanceLightStatusBars(darkTopIcons);
            icons.setAppearanceLightNavigationBars(darkBottomIcons);
            call.resolve();
        });
    }
}
