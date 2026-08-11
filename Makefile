SHELL := /bin/sh

APP := gpio_lighttree
TARGET ?= aarch64-unknown-linux-musl
TARGET_HOST ?= nyamnyam@192.168.0.179
REMOTE_PATH ?= /home/nyamnyam/
NPM ?= npm
CROSS ?= cross

WEB_DIR := web
STATIC_HTML := static/index.html
WEB_SOURCES := \
	$(wildcard $(WEB_DIR)/src/*) \
	$(WEB_DIR)/index.html \
	$(WEB_DIR)/vite.config.ts \
	$(WEB_DIR)/tsconfig.json \
	$(WEB_DIR)/package.json \
	$(WEB_DIR)/package-lock.json
BINARY := target/$(TARGET)/release/$(APP)
DIST_DIR := dist
PACKAGE_ROOT := $(DIST_DIR)/$(APP)
PACKAGE := $(DIST_DIR)/$(APP)-$(TARGET).tgz

.PHONY: all html rust package upload clean

all: package

html: $(STATIC_HTML)

$(WEB_DIR)/node_modules/.package-lock.json: $(WEB_DIR)/package.json $(WEB_DIR)/package-lock.json
	cd $(WEB_DIR) && $(NPM) ci

$(STATIC_HTML): $(WEB_SOURCES) $(WEB_DIR)/node_modules/.package-lock.json
	cd $(WEB_DIR) && $(NPM) run build

rust: html
	$(CROSS) build --release --target $(TARGET)

package: $(PACKAGE)

$(PACKAGE): rust
	rm -rf "$(PACKAGE_ROOT)"
	mkdir -p "$(PACKAGE_ROOT)/static"
	cp "$(BINARY)" "$(PACKAGE_ROOT)/$(APP)"
	cp "$(STATIC_HTML)" "$(PACKAGE_ROOT)/static/index.html"
	tar -czf "$(PACKAGE)" -C "$(DIST_DIR)" "$(APP)"

upload: package
	scp "$(PACKAGE)" "$(TARGET_HOST):$(REMOTE_PATH)"

clean:
	rm -rf "$(DIST_DIR)" "$(WEB_DIR)/node_modules" "$(STATIC_HTML)"
	cargo clean
