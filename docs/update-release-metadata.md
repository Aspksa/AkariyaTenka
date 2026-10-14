# Release metadata publication

Tagged release publishing now constructs `AkariyaTenka.release.json` from the final ZIP bytes, release tag and source SHA. This ensures future signatures bind the actual artifact. The JSON is **not signed yet**, and clients must not trust or automatically install it based only on its presence or co-hosted checksum. Configure an independently pinned publisher key, protected signing credentials and publish an accompanying Ed25519 signature before enabling unattended installation. The existing update installer is not invoked by this workflow.
