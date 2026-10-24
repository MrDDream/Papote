import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Signature release : keystore.properties à la racine d'android/ (ignoré par git), sinon variables
 * d'environnement PAPOTE_STORE_FILE, PAPOTE_STORE_PASSWORD, PAPOTE_KEY_ALIAS, PAPOTE_KEY_PASSWORD.
 * Sans l'un ni l'autre, la variante release est produite non signée.
 */
val signing: Map<String, String>? = run {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) {
        Properties().apply { file.inputStream().use { load(it) } }.let { p -> p.stringPropertyNames().associateWith { p.getProperty(it) } }
    } else {
        System.getenv("PAPOTE_STORE_FILE")?.let {
            mapOf(
                "storeFile" to it,
                "storePassword" to System.getenv("PAPOTE_STORE_PASSWORD").orEmpty(),
                "keyAlias" to System.getenv("PAPOTE_KEY_ALIAS").orEmpty(),
                "keyPassword" to System.getenv("PAPOTE_KEY_PASSWORD").orEmpty(),
            )
        }
    }
}

android {
    namespace = "fr.papote.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "fr.papote.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 4
        versionName = "0.4.0"
    }

    signingConfigs {
        if (signing != null) create("release") {
            storeFile = file(signing.getValue("storeFile"))
            storePassword = signing.getValue("storePassword")
            keyAlias = signing.getValue("keyAlias")
            keyPassword = signing.getValue("keyPassword")
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // APK nommé Papote-v<version>-<variante>.apk
    base.archivesName.set("Papote-v${defaultConfig.versionName}")

    // English texts: one file for the web app and this one.
    sourceSets["main"].assets.srcDir("../../server/web/i18n")

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.navigation.compose)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.okhttp.core)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.coil.compose)
    implementation(libs.androidx.biometric)
    implementation("io.coil-kt:coil-gif:2.7.0")
    // QR codes: drawing them (core) and scanning them with the camera (no Google services).
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    testImplementation(libs.junit)
}
