.PHONY: build dev clean

build:
	cd web && npm run build
	rm -rf server/static && cp -r web/dist server/static
	cd server && CGO_ENABLED=1 go build -o ../wargame-replay .

dev:
	@echo "Start in two terminals:"
	@echo "  Terminal 1: cd server && go run . --dir ../../"
	@echo "  Terminal 2: cd web && npm run dev"

clean:
	rm -rf web/dist server/static wargame-replay
