# Code signing policy

Free code signing is provided by [SignPath.io](https://signpath.io/), with a certificate issued by the [SignPath Foundation](https://signpath.org/).

## Signed releases

- Official Windows installers are published on the [RefFlow Studio GitHub Releases page](https://github.com/amine1859/Referenceflow-Studio/releases).
- Signing requests must originate from this repository's GitHub-hosted build workflow and correspond to a versioned source revision.
- Release artifacts must use the RefFlow Studio product name and a consistent version across executable metadata and installer filenames.
- The auto-update metadata must be generated from the final signed installer so its checksum matches the file delivered to users.
- Every signing request requires approval from the project approver.

## Team roles

- Committer and reviewer: [amine1859](https://github.com/amine1859)
- Signing approver: [amine1859](https://github.com/amine1859)

## Privacy

RefFlow Studio's data handling is documented in the [privacy policy](PRIVACY.md).
