plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

/**
 * Firebase, for push (docs/SPEC.md §13): the four values the app needs, read from the git-ignored
 * google-services.json next to this file (CARD-042). Without that file they are empty and the app runs without push.
 */
val firebase: Map<String, String> = file("google-services.json").takeIf { it.exists() }?.let { f ->
    val json = groovy.json.JsonSlurper().parse(f) as Map<*, *>
    val project = json["project_info"] as Map<*, *>
    val client = (json["client"] as List<*>).map { it as Map<*, *> }.first {
        val info = it["client_info"] as Map<*, *>
        (info["android_client_info"] as Map<*, *>)["package_name"] == "au.screentime.parent"
    }
    mapOf(
        "FIREBASE_APP_ID" to (client["client_info"] as Map<*, *>)["mobilesdk_app_id"] as String,
        "FIREBASE_API_KEY" to ((client["api_key"] as List<*>).first() as Map<*, *>)["current_key"] as String,
        "FIREBASE_PROJECT_ID" to project["project_id"] as String,
        "FIREBASE_SENDER_ID" to project["project_number"] as String,
    )
} ?: emptyMap()

android {
    namespace = "au.screentime.parent"
    compileSdk = 37

    defaultConfig {
        applicationId = "au.screentime.parent"
        minSdk = 34
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        for (name in listOf("FIREBASE_APP_ID", "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_SENDER_ID")) {
            buildConfigField("String", name, "\"${firebase[name].orEmpty()}\"")
        }
    }

    buildTypes {
        debug {
            // The Android emulator reaches the developer's PC at 10.0.2.2 (`pnpm dev:server` or docker compose).
            buildConfigField("String", "SERVER", "\"http://10.0.2.2:8080\"")
        }
        release {
            buildConfigField("String", "SERVER", "\"https://screentime.gallagherhome.au\"")
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
    implementation(libs.zxing.core)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.ktor.client.mock)
    testRuntimeOnly(libs.junit.platform.launcher)
}
