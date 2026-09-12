/**
 * Sun PowerTools ERP - Reusable Searchable Select / Combobox Component
 * Accessible, lightweight, mobile-responsive, keyboard navigable.
 */
(function (window, document) {
    'use strict';

    class SearchableSelect {
        constructor(selectElement, userOptions = {}) {
            if (!selectElement || selectElement._searchableSelect) {
                return selectElement ? selectElement._searchableSelect : null;
            }

            this.select = selectElement;
            this.select._searchableSelect = this;

            this.options = Object.assign({
                placeholder: this.select.getAttribute('data-placeholder') || this.getDefaultPlaceholder(),
                allowClear: this.select.getAttribute('data-allow-clear') !== 'false' && !this.select.required,
                searchPlaceholder: this.select.getAttribute('data-search-placeholder') || 'Search...',
                noResultsText: this.select.getAttribute('data-no-results') || 'No matching options found',
                debounceMs: parseInt(this.select.getAttribute('data-debounce') || '250', 10),
                asyncUrl: this.select.getAttribute('data-async-url') || null,
                mobileModalBreakpoint: 576
            }, userOptions);

            this.isOpen = false;
            this.highlightedIndex = -1;
            this.items = [];
            this.filteredItems = [];
            this.debounceTimer = null;

            this.init();
        }

        getDefaultPlaceholder() {
            const firstOption = this.select.querySelector('option[value=""]') || this.select.options[0];
            if (firstOption && (!firstOption.value || firstOption.text.includes('--') || firstOption.text.toLowerCase().includes('select'))) {
                return firstOption.text.replace(/^--\s*|\s*--$/g, '').trim();
            }
            return 'Select option';
        }

        init() {
            // Build wrapper and custom UI elements
            this.wrapper = document.createElement('div');
            this.wrapper.className = 'searchable-select-wrap';
            if (this.select.className) {
                // Copy sizing classes if any (e.g. form-select-sm)
                if (this.select.classList.contains('form-select-sm')) {
                    this.wrapper.classList.add('searchable-select-sm');
                }
                if (this.select.classList.contains('form-select-lg')) {
                    this.wrapper.classList.add('searchable-select-lg');
                }
                if (this.select.classList.contains('is-invalid')) {
                    this.wrapper.classList.add('is-invalid');
                }
            }

            // Hide native select visually but keep in DOM for form submission and HTML5 validation
            this.select.classList.add('searchable-select-native');
            this.select.setAttribute('tabindex', '-1');
            this.select.setAttribute('aria-hidden', 'true');

            // Insert wrapper immediately before select, then place select inside wrapper
            this.select.parentNode.insertBefore(this.wrapper, this.select);
            this.wrapper.appendChild(this.select);

            // Trigger button
            this.trigger = document.createElement('button');
            this.trigger.type = 'button';
            this.trigger.className = 'searchable-select-trigger';
            this.trigger.setAttribute('aria-haspopup', 'listbox');
            this.trigger.setAttribute('aria-expanded', 'false');
            if (this.select.disabled) {
                this.trigger.disabled = true;
                this.wrapper.classList.add('is-disabled');
            }

            this.triggerLabel = document.createElement('span');
            this.triggerLabel.className = 'searchable-select-label';

            this.triggerActions = document.createElement('span');
            this.triggerActions.className = 'searchable-select-actions';

            // Clear button
            this.clearBtn = document.createElement('span');
            this.clearBtn.className = 'searchable-select-clear';
            this.clearBtn.innerHTML = '&times;';
            this.clearBtn.title = 'Clear selection';
            this.clearBtn.setAttribute('role', 'button');
            this.clearBtn.setAttribute('tabindex', '-1');
            this.clearBtn.style.display = 'none';

            // Arrow indicator
            this.arrow = document.createElement('span');
            this.arrow.className = 'searchable-select-arrow';
            this.arrow.innerHTML = '<i class="bi bi-chevron-down"></i>';

            this.triggerActions.appendChild(this.clearBtn);
            this.triggerActions.appendChild(this.arrow);

            this.trigger.appendChild(this.triggerLabel);
            this.trigger.appendChild(this.triggerActions);
            this.wrapper.appendChild(this.trigger);

            // Dropdown panel
            this.dropdown = document.createElement('div');
            this.dropdown.className = 'searchable-select-dropdown';
            this.dropdown.setAttribute('role', 'listbox');

            // Mobile backdrop
            this.backdrop = document.createElement('div');
            this.backdrop.className = 'searchable-select-backdrop';

            // Search box container
            this.searchBox = document.createElement('div');
            this.searchBox.className = 'searchable-select-search';

            this.searchInput = document.createElement('input');
            this.searchInput.type = 'text';
            this.searchInput.className = 'searchable-select-input';
            this.searchInput.placeholder = this.options.searchPlaceholder;
            this.searchInput.setAttribute('autocomplete', 'off');
            this.searchInput.setAttribute('autocorrect', 'off');
            this.searchInput.setAttribute('autocapitalize', 'off');
            this.searchInput.setAttribute('spellcheck', 'false');

            const searchIcon = document.createElement('span');
            searchIcon.className = 'searchable-select-search-icon';
            searchIcon.innerHTML = '<i class="bi bi-search"></i>';

            this.searchBox.appendChild(searchIcon);
            this.searchBox.appendChild(this.searchInput);
            this.dropdown.appendChild(this.searchBox);

            // Options list
            this.optionsList = document.createElement('ul');
            this.optionsList.className = 'searchable-select-options';
            this.dropdown.appendChild(this.optionsList);

            this.wrapper.appendChild(this.dropdown);
            this.wrapper.appendChild(this.backdrop);

            // Extract initial options
            this.readNativeOptions();
            this.updateTriggerDisplay();

            // Bind events
            this.bindEvents();
        }

        readNativeOptions() {
            this.items = [];
            const nativeOptions = Array.from(this.select.options);

            nativeOptions.forEach((opt, idx) => {
                // Determine if placeholder option
                const isPlaceholder = opt.value === '' && (opt.text.includes('--') || opt.text.toLowerCase().includes('select'));
                this.items.push({
                    index: idx,
                    value: opt.value,
                    text: opt.text.trim(),
                    disabled: opt.disabled,
                    selected: opt.selected,
                    isPlaceholder: isPlaceholder,
                    // Additional metadata attributes
                    code: opt.getAttribute('data-code') || '',
                    price: opt.getAttribute('data-price') || '',
                    stock: opt.getAttribute('data-stock') || '',
                    unit: opt.getAttribute('data-unit') || '',
                    brand: opt.getAttribute('data-brand') || '',
                    category: opt.getAttribute('data-category') || ''
                });
            });

            this.filteredItems = [...this.items];
        }

        updateTriggerDisplay() {
            const selectedOpt = this.select.options[this.select.selectedIndex];
            if (selectedOpt && selectedOpt.value !== '') {
                this.triggerLabel.textContent = selectedOpt.text.trim();
                this.triggerLabel.classList.remove('is-placeholder');
                if (this.options.allowClear && !this.select.disabled) {
                    this.clearBtn.style.display = 'inline-flex';
                } else {
                    this.clearBtn.style.display = 'none';
                }
            } else {
                this.triggerLabel.textContent = this.options.placeholder;
                this.triggerLabel.classList.add('is-placeholder');
                this.clearBtn.style.display = 'none';
            }

            // Sync disabled state
            if (this.select.disabled) {
                this.trigger.disabled = true;
                this.wrapper.classList.add('is-disabled');
            } else {
                this.trigger.disabled = false;
                this.wrapper.classList.remove('is-disabled');
            }

            // Sync invalid state
            if (this.select.classList.contains('is-invalid')) {
                this.wrapper.classList.add('is-invalid');
            } else {
                this.wrapper.classList.remove('is-invalid');
            }
        }

        renderOptions() {
            this.optionsList.innerHTML = '';
            this.highlightedIndex = -1;

            // Filter out empty placeholder option from choices list if other choices exist
            const displayItems = this.filteredItems.filter(item => !item.isPlaceholder);

            if (displayItems.length === 0) {
                const emptyLi = document.createElement('li');
                emptyLi.className = 'searchable-select-empty';
                emptyLi.innerHTML = `<i class="bi bi-info-circle me-1"></i> ${this.options.noResultsText}`;
                this.optionsList.appendChild(emptyLi);
                return;
            }

            displayItems.forEach((item, filteredIdx) => {
                const li = document.createElement('li');
                li.className = 'searchable-select-option';
                li.setAttribute('role', 'option');
                li.setAttribute('data-value', item.value);
                li.setAttribute('data-index', item.index);

                if (item.selected) {
                    li.classList.add('is-selected');
                    li.setAttribute('aria-selected', 'true');
                    this.highlightedIndex = filteredIdx;
                } else {
                    li.setAttribute('aria-selected', 'false');
                }

                if (item.disabled) {
                    li.classList.add('is-disabled');
                }

                // Option content with rich badge support if available
                let contentHtml = `<span class="searchable-select-option-text">${this.escapeHtml(item.text)}</span>`;
                
                // Add secondary badges if stock or price or brand are present
                if (item.stock !== '' || item.price !== '') {
                    contentHtml += `<div class="searchable-select-badges">`;
                    if (item.stock !== '') {
                        const stockVal = parseFloat(item.stock);
                        const badgeClass = stockVal <= 0 ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success';
                        contentHtml += `<span class="badge ${badgeClass} me-1">Stock: ${stockVal}</span>`;
                    }
                    if (item.price !== '') {
                        contentHtml += `<span class="badge bg-primary-subtle text-primary">₹${parseFloat(item.price).toFixed(2)}</span>`;
                    }
                    contentHtml += `</div>`;
                }

                if (item.selected) {
                    contentHtml += `<i class="bi bi-check2 searchable-select-check"></i>`;
                }

                li.innerHTML = contentHtml;

                // Mouse hover highlight
                li.addEventListener('mouseenter', () => {
                    if (!item.disabled) {
                        this.setHighlight(filteredIdx);
                    }
                });

                // Click to select
                li.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!item.disabled) {
                        this.selectOption(item);
                    }
                });

                this.optionsList.appendChild(li);
            });

            this.scrollToHighlighted();
        }

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        bindEvents() {
            // Trigger click
            this.trigger.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.select.disabled) return;
                this.toggle();
            });

            // Clear button click
            this.clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.clear();
            });

            // Backdrop click (mobile)
            this.backdrop.addEventListener('click', () => {
                this.close();
            });

            // Search input typing with debounced filter
            this.searchInput.addEventListener('input', () => {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    this.filterOptions(this.searchInput.value);
                }, this.options.debounceMs);
            });

            // Keyboard navigation on trigger
            this.trigger.addEventListener('keydown', (e) => {
                if (this.select.disabled) return;

                switch (e.key) {
                    case 'ArrowDown':
                    case 'Down':
                    case 'Enter':
                    case ' ':
                        e.preventDefault();
                        this.open();
                        break;
                    case 'Escape':
                    case 'Esc':
                        this.close();
                        break;
                }
            });

            // Keyboard navigation inside search input & dropdown
            this.dropdown.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case 'ArrowDown':
                    case 'Down':
                        e.preventDefault();
                        this.moveHighlight(1);
                        break;
                    case 'ArrowUp':
                    case 'Up':
                        e.preventDefault();
                        this.moveHighlight(-1);
                        break;
                    case 'Enter':
                        e.preventDefault();
                        this.selectHighlighted();
                        break;
                    case 'Escape':
                    case 'Esc':
                        e.preventDefault();
                        this.close();
                        this.trigger.focus();
                        break;
                    case 'Tab':
                        this.close();
                        break;
                }
            });

            // Close on click outside
            document.addEventListener('click', (e) => {
                if (this.isOpen && !this.wrapper.contains(e.target)) {
                    this.close();
                }
            });

            // Reposition on window resize / scroll
            window.addEventListener('resize', () => {
                if (this.isOpen) {
                    this.positionDropdown();
                }
            });

            // Native select change event listener (sync if altered programmatically)
            this.select.addEventListener('change', () => {
                this.readNativeOptions();
                this.updateTriggerDisplay();
            });
        }

        filterOptions(query) {
            const cleanQuery = query.trim().toLowerCase();
            if (!cleanQuery) {
                this.filteredItems = [...this.items];
            } else {
                this.filteredItems = this.items.filter(item => {
                    if (item.isPlaceholder) return false;
                    const matchText = (item.text || '').toLowerCase().includes(cleanQuery);
                    const matchCode = (item.code || '').toLowerCase().includes(cleanQuery);
                    const matchBrand = (item.brand || '').toLowerCase().includes(cleanQuery);
                    const matchCat = (item.category || '').toLowerCase().includes(cleanQuery);
                    return matchText || matchCode || matchBrand || matchCat;
                });
            }

            this.renderOptions();
        }

        open() {
            if (this.isOpen || this.select.disabled) return;

            // Close all other open instances first
            document.querySelectorAll('.searchable-select-wrap.is-open').forEach(wrap => {
                if (wrap !== this.wrapper && wrap.querySelector('select') && wrap.querySelector('select')._searchableSelect) {
                    wrap.querySelector('select')._searchableSelect.close();
                }
            });

            this.isOpen = true;
            this.wrapper.classList.add('is-open');
            this.trigger.setAttribute('aria-expanded', 'true');

            // Reset search input & filter
            this.searchInput.value = '';
            this.filterOptions('');

            this.positionDropdown();

            // Focus search input after render
            setTimeout(() => {
                this.searchInput.focus();
            }, 50);
        }

        close() {
            if (!this.isOpen) return;

            this.isOpen = false;
            this.wrapper.classList.remove('is-open');
            this.dropdown.classList.remove('dropup', 'mobile-sheet');
            this.dropdown.style.top = '';
            this.dropdown.style.bottom = '';
            this.dropdown.style.left = '';
            this.dropdown.style.width = '';
            this.trigger.setAttribute('aria-expanded', 'false');
        }

        toggle() {
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        }

        positionDropdown() {
            const isMobile = window.innerWidth <= this.options.mobileModalBreakpoint;

            if (isMobile) {
                // Mobile viewport: Clamped sheet / popover style
                this.dropdown.classList.add('mobile-sheet');
                return;
            }

            this.dropdown.classList.remove('mobile-sheet');

            const rect = this.wrapper.getBoundingClientRect();
            const dropdownHeight = 320; // Estimated max height
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;

            if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
                this.dropdown.classList.add('dropup');
            } else {
                this.dropdown.classList.remove('dropup');
            }
        }

        setHighlight(index) {
            const displayOptions = this.optionsList.querySelectorAll('.searchable-select-option:not(.is-disabled)');
            displayOptions.forEach((opt, idx) => {
                if (idx === index) {
                    opt.classList.add('is-highlighted');
                    this.highlightedIndex = idx;
                } else {
                    opt.classList.remove('is-highlighted');
                }
            });
        }

        moveHighlight(delta) {
            const displayOptions = this.optionsList.querySelectorAll('.searchable-select-option:not(.is-disabled)');
            if (displayOptions.length === 0) return;

            let newIndex = this.highlightedIndex + delta;
            if (newIndex < 0) newIndex = displayOptions.length - 1;
            if (newIndex >= displayOptions.length) newIndex = 0;

            this.setHighlight(newIndex);
            this.scrollToHighlighted();
        }

        scrollToHighlighted() {
            const highlighted = this.optionsList.querySelector('.searchable-select-option.is-highlighted');
            if (highlighted) {
                const listRect = this.optionsList.getBoundingClientRect();
                const itemRect = highlighted.getBoundingClientRect();

                if (itemRect.bottom > listRect.bottom) {
                    this.optionsList.scrollTop += (itemRect.bottom - listRect.bottom);
                } else if (itemRect.top < listRect.top) {
                    this.optionsList.scrollTop -= (listRect.top - itemRect.top);
                }
            }
        }

        selectHighlighted() {
            const displayOptions = this.optionsList.querySelectorAll('.searchable-select-option:not(.is-disabled)');
            if (this.highlightedIndex >= 0 && this.highlightedIndex < displayOptions.length) {
                const targetLi = displayOptions[this.highlightedIndex];
                const val = targetLi.getAttribute('data-value');
                const matchedItem = this.items.find(i => String(i.value) === String(val));
                if (matchedItem) {
                    this.selectOption(matchedItem);
                }
            }
        }

        selectOption(item) {
            this.select.value = item.value;

            // Trigger change and input events so existing calculations, lookups, and handlers execute
            this.select.dispatchEvent(new Event('change', { bubbles: true }));
            this.select.dispatchEvent(new Event('input', { bubbles: true }));

            this.readNativeOptions();
            this.updateTriggerDisplay();
            this.close();
            this.trigger.focus();
        }

        clear() {
            // Find empty placeholder option if present
            const emptyOpt = this.select.querySelector('option[value=""]');
            if (emptyOpt) {
                this.select.value = '';
            } else {
                this.select.selectedIndex = -1;
            }

            this.select.dispatchEvent(new Event('change', { bubbles: true }));
            this.select.dispatchEvent(new Event('input', { bubbles: true }));

            this.readNativeOptions();
            this.updateTriggerDisplay();
            this.close();
            this.trigger.focus();
        }

        refresh() {
            this.readNativeOptions();
            this.updateTriggerDisplay();
            if (this.isOpen) {
                this.renderOptions();
            }
        }

        destroy() {
            this.select.classList.remove('searchable-select-native');
            this.select.removeAttribute('tabindex');
            this.select.removeAttribute('aria-hidden');
            if (this.wrapper && this.wrapper.parentNode) {
                this.wrapper.parentNode.insertBefore(this.select, this.wrapper);
                this.wrapper.remove();
            }
            delete this.select._searchableSelect;
        }

        static init(selectorOrElement, options = {}) {
            if (typeof selectorOrElement === 'string') {
                const elements = document.querySelectorAll(selectorOrElement);
                const instances = [];
                elements.forEach(el => {
                    instances.push(new SearchableSelect(el, options));
                });
                return instances;
            } else if (selectorOrElement instanceof HTMLElement) {
                return new SearchableSelect(selectorOrElement, options);
            }
        }
    }

    // Auto-initialize any select with class 'searchable-select' upon DOM ready
    function autoInit() {
        document.querySelectorAll('select.searchable-select:not(.searchable-select-native)').forEach(el => {
            new SearchableSelect(el);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }

    window.SearchableSelect = SearchableSelect;

})(window, document);
