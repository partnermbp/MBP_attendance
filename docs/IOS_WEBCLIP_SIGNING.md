# Signing the MBP Attendance iOS Web Clip profile

The Pages deployment workflow can CMS-sign `dist/mbp-attendance-ios.mobileconfig` during GitHub Actions. The signing key is never committed to the repository.

## Required GitHub Actions secrets

Open **GitHub → partnermbp/MBP_attendance → Settings → Secrets and variables → Actions → New repository secret** and add:

- `IOS_PROFILE_SIGNING_CERT_PEM`: PEM-encoded signing certificate (including BEGIN/END CERTIFICATE lines).
- `IOS_PROFILE_SIGNING_KEY_PEM`: PEM-encoded private key matching that certificate.
- `IOS_PROFILE_SIGNING_KEY_PASSWORD`: optional password if the private key is encrypted. If not encrypted, omit this secret.

The certificate and private key must match. Keep the private key confidential and never commit it to Git.

## Important trust distinction

The workflow creates an attached CMS signature and verifies that the signed profile contains the exact original profile bytes. This verifies cryptographic integrity, not whether iOS trusts the certificate issuer.

For the profile to show a trusted/verified signer, use a certificate whose chain is trusted by the target iOS devices, or separately deploy and trust the signing certificate through an appropriate managed-device trust process. A self-signed certificate can produce a valid CMS signature but does not automatically become trusted by iOS.

This is a signed configuration profile, not an Apple-signed native iOS application. It does not require an App Store provisioning profile.

## Deployment behavior

- If both certificate and key secrets are configured, the deployment signs and verifies the Web Clip profile before publishing.
- If neither is configured, deployment continues but explicitly warns that the profile remains unsigned.
- If only one is configured or signature verification fails, the build fails rather than publishing a misleading artifact.
- The signing secrets are only exposed to the signing step on the ephemeral GitHub-hosted runner.
