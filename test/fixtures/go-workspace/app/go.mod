module example.com/app

go 1.22

require github.com/gorilla/mux v1.8.1

require (
	golang.org/x/text v0.14.0 // indirect
	example.com/forked v1.0.0
	example.com/vendored v0.1.0
)

replace example.com/forked => github.com/BurntSushi/toml v1.3.2

replace example.com/vendored => ../vendored
