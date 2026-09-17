(function () {
  'use strict';

  var isTouch = window.matchMedia('(hover: none)').matches;

  /* CUSTOM CURSOR */
  var cursor = document.getElementById('cursor');
  if (!isTouch && cursor) {
    window.addEventListener('mousemove', function (e) {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    });

    function cursorGrow() {
      cursor.style.width = '64px';
      cursor.style.height = '64px';
      cursor.style.background = 'rgba(237,237,237,0.15)';
    }
    function cursorZoom() {
      cursor.style.width = '80px';
      cursor.style.height = '80px';
      cursor.style.background = 'rgba(237,237,237,0.2)';
    }
    function cursorShrink() {
      cursor.style.width = '36px';
      cursor.style.height = '36px';
      cursor.style.background = 'transparent';
    }

    document.querySelectorAll('.hoverable').forEach(function (el) {
      el.addEventListener('mouseenter', cursorGrow);
      el.addEventListener('mouseleave', cursorShrink);
    });
    document.querySelectorAll('.hoverable-zoom').forEach(function (el) {
      el.addEventListener('mouseenter', cursorZoom);
      el.addEventListener('mouseleave', cursorShrink);
    });
  }

  /* HERO ENTRANCE */
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      document.body.classList.add('ready');
    });
  });

  /* SCROLL PROGRESS + PARALLAX */
  var progressBar = document.getElementById('scroll-progress');
  var heroImgWrap = document.getElementById('hero-img-wrap');
  function onScroll() {
    var docH = document.documentElement.scrollHeight - window.innerHeight;
    var progress = docH > 0 ? (window.scrollY / docH) * 100 : 0;
    progressBar.style.width = progress.toFixed(1) + '%';
    if (heroImgWrap) {
      heroImgWrap.style.transform = 'translateY(' + (window.scrollY * 0.25) + 'px)';
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* MARQUEE — build duplicated list for seamless loop */
  var marqueeItems = ['SIŁA', 'MOBILNOŚĆ', 'TECHNIKA', 'WYTRZYMAŁOŚĆ', 'REGENERACJA', 'DYSCYPLINA'];
  var track = document.getElementById('marquee-track');
  var marqueeHtml = '';
  for (var m = 0; m < 2; m++) {
    marqueeItems.forEach(function (word) {
      marqueeHtml += '<span>' + word + '</span><span>·</span>';
    });
  }
  track.innerHTML = marqueeHtml;

  /* NAV ACTIVE LINK + SECTION REVEALS */
  var navLinks = document.querySelectorAll('.nav-link');
  var sectionClassMap = {
    about: 'about-visible',
    gallery: 'gallery-visible',
    offer: 'offer-visible',
    reviews: 'reviews-visible',
    contact: 'contact-visible'
  };
  var statsAnimated = false;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var key = entry.target.getAttribute('data-section');
      if (!key || !entry.isIntersecting) return;

      if (key !== 'stats') {
        navLinks.forEach(function (link) {
          link.classList.toggle('active', link.getAttribute('data-key') === key);
        });
      }

      if (sectionClassMap[key]) {
        document.body.classList.add(sectionClassMap[key]);
      }

      if (key === 'stats' && !statsAnimated) {
        statsAnimated = true;
        animateStats();
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('[data-section]').forEach(function (el) {
    observer.observe(el);
  });

  /* NAV SMOOTH SCROLL */
  document.querySelectorAll('.nav-link, .nav-cta, a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var href = link.getAttribute('href');
      if (!href || href.charAt(0) !== '#' || href.length < 2) return;
      var target = document.getElementById(href.slice(1));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* STATS COUNTER */
  function animateStats() {
    var statEls = document.querySelectorAll('.stat-value');
    var duration = 1400;
    var start = performance.now();
    function tick(now) {
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      statEls.forEach(function (el) {
        var target = parseFloat(el.getAttribute('data-target'));
        var suffix = el.getAttribute('data-suffix') || '';
        var val = Math.round(target * eased);
        el.textContent = suffix === ':1' ? val + ':1' : val + suffix;
      });
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* TILT EFFECT (gallery + plan cards) */
  function attachTilt(el, opts) {
    opts = opts || {};
    var maxTilt = opts.maxTilt || 6;
    var scale = opts.scale || 1.04;
    el.addEventListener('mousemove', function (e) {
      var rect = el.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width - 0.5;
      var y = (e.clientY - rect.top) / rect.height - 0.5;
      el.style.transform = 'perspective(900px) rotateX(' + (y * -maxTilt).toFixed(2) + 'deg) rotateY(' + (x * maxTilt).toFixed(2) + 'deg) scale3d(' + scale + ',' + scale + ',' + scale + ')';
    });
    el.addEventListener('mouseleave', function () {
      el.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)';
    });
  }
  if (!isTouch) {
    document.querySelectorAll('.gallery-item, .plan-card').forEach(function (el) {
      attachTilt(el);
    });
  }

  /* LIGHTBOX */
  var lightbox = document.getElementById('lightbox');
  var lightboxImg = document.getElementById('lightbox-img');
  document.querySelectorAll('.gallery-item').forEach(function (item) {
    item.addEventListener('click', function () {
      lightboxImg.src = item.getAttribute('data-src');
      lightbox.classList.add('open');
    });
  });
  function closeLightbox() { lightbox.classList.remove('open'); }
  lightbox.addEventListener('click', closeLightbox);
  document.getElementById('lightbox-close').addEventListener('click', function (e) {
    e.stopPropagation();
    closeLightbox();
  });

  /* REVIEWS CAROUSEL */
  var reviewsTrack = document.getElementById('reviews-track');
  var reviewCards = reviewsTrack.querySelectorAll('.review-card');
  var dotsWrap = document.getElementById('review-dots');
  var reviewIndex = 0;
  var reviewTimer = null;

  reviewCards.forEach(function (_, i) {
    var dot = document.createElement('button');
    dot.setAttribute('aria-label', 'Opinia ' + (i + 1));
    dot.addEventListener('click', function () { goToReview(i); });
    dotsWrap.appendChild(dot);
  });
  var dots = dotsWrap.querySelectorAll('button');

  function renderReview() {
    reviewsTrack.style.transform = 'translateX(-' + reviewIndex + '00%)';
    dots.forEach(function (d, i) {
      d.classList.toggle('active', i === reviewIndex);
    });
  }
  function goToReview(i) {
    reviewIndex = i;
    renderReview();
    restartAutoplay();
  }
  function nextReview() {
    reviewIndex = (reviewIndex + 1) % reviewCards.length;
    renderReview();
  }
  function prevReview() {
    reviewIndex = (reviewIndex - 1 + reviewCards.length) % reviewCards.length;
    renderReview();
  }
  function restartAutoplay() {
    if (reviewTimer) clearInterval(reviewTimer);
    reviewTimer = setInterval(nextReview, 6000);
  }

  document.getElementById('review-next').addEventListener('click', function () { nextReview(); restartAutoplay(); });
  document.getElementById('review-prev').addEventListener('click', function () { prevReview(); restartAutoplay(); });

  renderReview();
  restartAutoplay();

  /* CONTACT FORM — submits via FormSubmit.co (no backend needed, works on GitHub Pages).
     First real submission triggers a one-time "confirm this form" email to
     kontakt@sebastianpalej.com — click the activation link there once, then
     every future submission is delivered automatically. */
  var form = document.getElementById('contact-form');

  function showFormMessage(kind, text) {
    var existing = form.querySelector('.form-note, .form-error');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = kind;
    el.textContent = text;
    form.appendChild(el);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Wysyłanie...';

    var payload = {};
    new FormData(form).forEach(function (value, key) { payload[key] = value; });

    fetch('https://formsubmit.co/ajax/kontakt@sebastianpalej.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('bad status');
        return res.json();
      })
      .then(function (data) {
        if (!data || data.success === false) throw new Error('formsubmit error');
        btn.textContent = 'Zgłoszenie wysłane ✓';
        showFormMessage('form-note', 'Dziękuję! Oddzwonię w ciągu 24 godzin.');
        form.reset();
      })
      .catch(function () {
        showFormMessage('form-error', 'Coś poszło nie tak. Spróbuj ponownie albo napisz bezpośrednio na kontakt@sebastianpalej.com.');
      })
      .finally(function () {
        setTimeout(function () {
          btn.disabled = false;
          btn.textContent = originalText;
        }, 3000);
      });
  });
})();
