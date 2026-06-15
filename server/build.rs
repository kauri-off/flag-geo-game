//! Compiles the shared protobuf contract (`../proto`) into Rust (prost messages +
//! tonic service skeletons). A vendored `protoc` is used so the build is hermetic
//! and needs no system protobuf compiler on any platform (incl. Windows/Docker).
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    std::env::set_var("PROTOC", protoc);

    tonic_build::configure()
        .build_server(true)
        .build_client(false)
        .compile_protos(&["../proto/flaggeo/v1/flaggeo.proto"], &["../proto"])?;

    println!("cargo:rerun-if-changed=../proto/flaggeo/v1/flaggeo.proto");
    Ok(())
}
