(function () {
  const DEFAULT_HOST = 'https://eu.i.posthog.com';
  const anonymousId =
    (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
    `anon-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const context = {
    distinctId: anonymousId,
    app: 'speech-to-subtitles',
  };

  let initialized = false;
  let clientBootstrapped = false;

  // Ensure the PostHog stub exists so we can bootstrap even if the CDN script is blocked
  (function bootstrapPosthog(doc, existing) {
    if (existing.__SV || (window.posthog && window.posthog.__loaded)) {
      return;
    }
    const ph = existing;
    ph._i = [];
    ph.init = function (i, s, a) {
      function addMethod(target, method) {
        const parts = method.split('.');
        if (parts.length === 2) {
          target = target[parts[0]];
          method = parts[1];
        }
        target[method] = function () {
          target.push([method].concat(Array.prototype.slice.call(arguments, 0)));
        };
      }
      const script = doc.createElement('script');
      script.type = 'text/javascript';
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.src = s.api_host
        .replace('.i.posthog.com', '-assets.i.posthog.com')
        .concat('/static/array.js');
      const firstScript = doc.getElementsByTagName('script')[0];
      firstScript.parentNode.insertBefore(script, firstScript);
      let instance = existing;
      if (a !== undefined) {
        instance = existing[a] = [];
      } else {
        a = 'posthog';
      }
      instance.people = instance.people || [];
      instance.toString = function (noStub) {
        let str = 'posthog';
        if ('posthog' !== a) {
          str += '.' + a;
        }
        return noStub ? str : str + ' (stub)';
      };
      instance.people.toString = function () {
        return instance.toString(1) + '.people (stub)';
      };
      const methods = 'init Rr Mr fi Or Ar ci Tr Cr capture Mi calculateEventProperties Lr register register_once register_for_session unregister unregister_for_session Hr getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty Ur jr createPersonProfile zr kr Br opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Dr debug M Nr getPageViewId captureTraceFeedback captureTraceMetric $r'.split(' ');
      for (let idx = 0; idx < methods.length; idx++) {
        addMethod(instance, methods[idx]);
      }
      existing._i.push([i, s, a]);
    };
    existing.__SV = 1;
    window.posthog = existing;
  })(document, window.posthog || []);

  function ensurePosthogClient() {
    const cfg = window.POSTHOG_CONFIG || {};
    if (!cfg.apiKey) {
      return null;
    }

    if (!clientBootstrapped) {
      const client = window.posthog;
      if (!client || typeof client.init !== 'function') {
        return null;
      }
      client.init(cfg.apiKey, {
        api_host: cfg.host || DEFAULT_HOST,
        capture_pageview: true,
        defaults: '2025-05-24',
        person_profiles: 'always',
        bootstrap: { distinctId: context.distinctId },
      });
      clientBootstrapped = true;
    }

    return window.posthog;
  }

  function init(role, extraContext = {}) {
    if (role) {
      context.role = role;
    }
    Object.assign(context, extraContext);

    const client = ensurePosthogClient();
    if (!client) {
      return false;
    }
    console.log('client', client);
    if (!initialized) {
      client.identify(context.distinctId, {
        role: context.role,
        app: context.app,
      });
      initialized = true;
    } else if (role) {
      client.setPersonProperties?.({ role: context.role });
    }

    return initialized;
  }

  function setContext(extraContext = {}) {
    Object.assign(context, extraContext);
  }

  function capture(event, properties = {}) {
    const client = ensurePosthogClient();
    if (!client || !initialized) {
      return;
    }
    client.capture(event, { ...context, ...properties });
  }

  function captureError(event, error, properties = {}) {
    capture(event, {
      ...properties,
      errorName: error?.name || 'Error',
      errorMessage: error?.message || String(error),
      errorStack: error?.stack,
    });
  }

  window.appAnalytics = {
    init,
    capture,
    captureError,
    setContext,
    isReady: () => initialized,
  };
})();
