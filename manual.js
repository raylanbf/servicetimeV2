'use strict';

const navItems = document.querySelectorAll('.nav-item');

function setActive(id) {
  navItems.forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + id);
  });
}

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) setActive(entry.target.id);
  });
}, { rootMargin: '-20% 0px -70% 0px' });

document.querySelectorAll('section[id]').forEach(s => observer.observe(s));

navItems.forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const id = a.getAttribute('href').slice(1);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setActive(id);
  });
});
