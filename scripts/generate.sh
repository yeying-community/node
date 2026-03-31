#!/usr/bin/env bash

base_name="${0##*/}"
script_dir=$(
  cd $(dirname "$0") || exit 1
  pwd
)

work_dir=$(
  cd "${script_dir}"/.. || exit 1
  pwd
)

usage() {
  printf "Usage: %s\n \
    -d <You can specify the directory of yeying-idl, default ../yeying-idl\n \
    " "${base_name}"
}

idl_dir=${work_dir}/../yeying-idl

# For macos`s getopt, reference: https://formulae.brew.sh/formula/gnu-getopt
while getopts ":d:" o; do
  case "${o}" in
  d)
    idl_dir=${OPTARG}
    ;;
  *)
    usage
    ;;
  esac
done
shift $((OPTIND - 1))

language=typescript
app_type=nodejs

output_dir=${idl_dir}/target/${app_type}/${language}
tool=${idl_dir}/script/compiler.sh

if ! "${tool}" -t ${app_type} -m common,bulletin,support,user,node,service,identity,certificate,application,event,invitation,mail,audit -l ${language}; then
  echo "Fail to generate proto code!"
  exit 1
fi

api_directory="${work_dir}"/src/yeying/api
if [ -d "${api_directory}" ]; then
  rm -rvf "${api_directory}"
fi

mkdir -p "${api_directory}"
cp -rvf "${output_dir}"/yeying/api/* "${api_directory}"/
# 在 user.proto 文件中导入 import "google/protobuf/wrappers.proto"; 但生成 TypeScript 时出现找不到模块的错误，通常是因为缺少 Google 的标准 Protobuf 库文件
# Google 的标准 Protobuf 库文件需额外生成和导入源码
cp -rvf "${output_dir}"/google "${work_dir}"/src/
