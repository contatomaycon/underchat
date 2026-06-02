const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const DEFAULT_ANDROID_PACKAGE = 'com.underchat.mobile';

function resolveAndroidPackage(config) {
  return config.android?.package || DEFAULT_ANDROID_PACKAGE;
}

function resolvePackageSourceDir(platformProjectRoot, packageName) {
  return path.join(
    platformProjectRoot,
    'app/src/main/java',
    ...packageName.split('.')
  );
}

function buildVideoTrimSupportModule(packageName) {
  return `package ${packageName}

import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class VideoTrimSupportModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "VideoTrimSupportModule"

    @ReactMethod
    fun getSupportedAbis(promise: Promise) {
        try {
            val abis = Arguments.createArray()
            Build.SUPPORTED_ABIS.forEach { abi ->
                abis.pushString(abi)
            }
            promise.resolve(abis)
        } catch (e: Exception) {
            promise.reject("VIDEO_TRIM_ABI_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun canLoadFfmpegKitAbiDetect(promise: Promise) {
        try {
            System.loadLibrary("ffmpegkit_abidetect")
            promise.resolve(true)
        } catch (_: Throwable) {
            promise.resolve(false)
        }
    }
}
`;
}

function buildVideoTrimSupportPackage(packageName) {
  return `@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class VideoTrimSupportPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(VideoTrimSupportModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
`;
}

function upsertFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (
    fs.existsSync(filePath) &&
    fs.readFileSync(filePath, 'utf8') === contents
  ) {
    return;
  }
  fs.writeFileSync(filePath, contents);
}

function registerVideoTrimSupportPackage(mainApplicationPath) {
  if (!fs.existsSync(mainApplicationPath)) {
    return;
  }

  const current = fs.readFileSync(mainApplicationPath, 'utf8');
  if (current.includes('VideoTrimSupportPackage()')) {
    return;
  }

  let next = current;
  if (next.includes('add(BatteryOptimizationPackage())')) {
    next = next.replace(
      'add(BatteryOptimizationPackage())',
      'add(BatteryOptimizationPackage())\n          add(VideoTrimSupportPackage())'
    );
  } else {
    next = next.replace(
      /(PackageList\(this\)\.packages\.apply\s*\{\n)/,
      '$1          add(VideoTrimSupportPackage())\n'
    );
  }

  if (next !== current) {
    fs.writeFileSync(mainApplicationPath, next);
  }
}

function withVideoTrimSupportModule(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const packageName = resolveAndroidPackage(modConfig);
      const sourceDir = resolvePackageSourceDir(
        modConfig.modRequest.platformProjectRoot,
        packageName
      );

      upsertFile(
        path.join(sourceDir, 'VideoTrimSupportModule.kt'),
        buildVideoTrimSupportModule(packageName)
      );
      upsertFile(
        path.join(sourceDir, 'VideoTrimSupportPackage.kt'),
        buildVideoTrimSupportPackage(packageName)
      );
      registerVideoTrimSupportPackage(
        path.join(sourceDir, 'MainApplication.kt')
      );

      return modConfig;
    },
  ]);
}

module.exports = withVideoTrimSupportModule;
