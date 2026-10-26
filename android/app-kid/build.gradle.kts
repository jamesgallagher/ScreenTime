plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "au.screentime.kid"
    compileSdk = 37

    defaultConfig {
        applicationId = "au.screentime.kid"
        minSdk = 34
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            // The Android emulator reaches the developer's PC at 10.0.2.2 (`pnpm dev:server` or docker compose).
            buildConfigField("String", "DEFAULT_SERVER", "\"http://10.0.2.2:8080\"")
        }
        release {
            buildConfigField("String", "DEFAULT_SERVER", "\"https://screentime.gallagherhome.au\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.all {
            it.useJUnitPlatform()
        }
    }
}

dependencies {
    implementation(project(":core-ui"))
    implementation(project(":core-time"))
    implementation(project(":core-model"))
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.ktor.client.okhttp)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}
