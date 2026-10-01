# GeoIP test fixtures

These databases come from MaxMind's openly licensed test data, so the tests need no network and
no DB-IP download:

- `GeoIP2-City-Test.mmdb`: a valid City database (about 22 KB). Known records include
  `81.2.69.142` (London, England, GB), `89.160.20.128` (Linköping, Östergötland County, SE) and
  `216.160.83.56` (Milton, Washington, US).
- `GeoIP2-City-Test-Invalid-Node-Count.mmdb`: the same database with a corrupt node count in its
  metadata. The install check must reject it.

Source: https://github.com/maxmind/MaxMind-DB, directory `test-data/`, commit
`276926d23b4109ca5452709bfb5931c338afb34c`. Copyright (c) 2013 - 2026 by MaxMind, Inc.
The MaxMind-DB repository is licensed under the Apache License, Version 2.0, or the MIT License, at your
option. These files are used under the MIT License, whose text is in `LICENSE-MaxMind-DB-MIT`.

The production database is DB-IP "IP to City Lite", which is licensed CC BY 4.0. It is downloaded
at run time and never committed (see `docs/ARCHITECTURE.md`, section 3.2, GeoResolve).
