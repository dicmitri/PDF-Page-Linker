const PDF_REDIRECT_RULE_IDS = [1, 2];

async function installPdfRedirectRules() {
  const viewerUrl = chrome.runtime.getURL("viewer.html#src=");
  const redirect = {
    regexSubstitution: `${viewerUrl}\\0`
  };

  const rules = [
    {
      id: 1,
      priority: 2,
      action: {
        type: "redirect",
        redirect
      },
      condition: {
        regexFilter: "^https?://.*\\.pdf([?#].*)?$",
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"]
      }
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: "redirect",
        redirect
      },
      condition: {
        regexFilter: "^https?://",
        resourceTypes: ["main_frame"],
        responseHeaders: [
          {
            header: "content-type",
            values: ["*application/pdf*"]
          }
        ]
      }
    }
  ];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: PDF_REDIRECT_RULE_IDS,
    addRules: rules
  });
}

chrome.runtime.onInstalled.addListener(() => {
  installPdfRedirectRules().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  installPdfRedirectRules().catch(console.error);
});
