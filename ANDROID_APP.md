# attendence_crm for Android

The Android app packages the existing React CRM with Capacitor. It uses the same Supabase backend, login flow, roles, attendance pages, team management, Telegram inbox and analytics as the web app.

## Build

The GitHub Actions workflow `.github/workflows/android-apk.yml` builds an installable debug APK automatically when relevant app files are pushed to `main`, or when manually started from the Actions tab.

Download the artifact named **attendence_crm-Android-APK** from the successful workflow run. The APK is at `android/app/build/outputs/apk/debug/attendence_crm.apk` during the build.

## Android app details

- App name: attendence_crm
- Application ID: `com.mostbetpartners.attendancecrm`
- Native location permission: approximate and precise location (requested by Android when check-in/check-out needs GPS)
- Web interface: bundled inside the APK; business data and authentication continue to use Supabase over the internet.

The debug APK is signed with the standard Android debug key so it can be installed directly for internal testing. A Play Store release or managed company distribution should use a private release keystore and a signed release build; do not distribute the debug key as a production signing key.

## Notes

- The APK contains the current CRM interface at the time it was built. Future code updates require a new APK build to reach installed devices.
- Supabase and Telegram services still need an internet connection.
- Employee invitation and password-recovery email links continue through the canonical CRM web URL so they do not redirect to the private Android WebView address.
