document.addEventListener("DOMContentLoaded", function() {
  // Extract mermaid code from <pre class="mermaid"><code>...</code></pre>
  document.querySelectorAll("pre.mermaid code").forEach(function(code) {
    var pre = code.parentElement;
    pre.textContent = code.textContent;
  });
  if (typeof mermaid !== "undefined") {
    mermaid.initialize({ startOnLoad: true, theme: "dark" });
  }
});
