.PHONY: build dev clean release

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

build:
	cd web && npm run build
	rm -rf server/static && cp -r web/dist server/static
	cd server && CGO_ENABLED=1 go build -trimpath \
		-ldflags="-s -w -X main.version=$(VERSION)" \
		-o ../wargame-replay .

dev:
	@echo "Start in two terminals:"
	@echo "  Terminal 1: cd server && go run . -dir ../../ -port 8081"
	@echo "  Terminal 2: cd web && npm run dev"

clean:
	rm -rf web/dist server/static wargame-replay

# Create a tagged release — triggers GitHub Actions workflow
# Usage: make release V=v1.0.0
release:
	@if [ -z "$(V)" ]; then echo "Usage: make release V=v1.0.0"; exit 1; fi
	git tag -a $(V) -m "Release $(V)"
	git push origin $(V)
	@echo "Tagged $(V) and pushed — GitHub Actions will build and publish the release."
