# Browser CDP Tab Engine

Use the user's active Chrome or Edge session when a reachable Chrome DevTools Protocol endpoint is available. Open a dedicated automation page with `context.newPage()` and bring that page to the foreground. Never close pre-existing user tabs or close an attached browser. If no active CDP endpoint exists, detect the Windows default browser from the HTTP UserChoice registry setting and launch a unified automation profile with CDP enabled.

Keep POS and SAP in separate automation tabs within the same browser context. On stop, close only pages created by OmniFlow. Do not restart or terminate a manually opened browser to enable CDP.
