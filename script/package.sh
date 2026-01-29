#!/usr/bin/env bash

script_dir=$(
  cd $(dirname "$0") || exit 1
  pwd
)

work_dir=$(
  cd "${script_dir}"/.. || exit 1
  pwd
)

version=1.0.0

if [ ! -z "$1" ]; then
  version="$1"
fi

src_resource_dir=${work_dir}/resources
src_script_dir=${work_dir}/script
src_dir=${work_dir}/src
src_third_party_dir=${work_dir}/third_party


index=1
echo -e "\nstep $index -- This is going to generate package for yeying-node"
output_dir=${work_dir}/output
if [ -d "${output_dir}" ]; then
  rm -rf "${output_dir}"
fi

index=$((index+1))
echo -e "\nstep $index -- prepare package files under directroy: ${output_dir}"
package_name=yeying-node-${version}
file_name=$package_name.tar.gz
node_dir=${output_dir}/${package_name}
mkdir -p "${node_dir}"


index=$((index+1))
echo -e "\nstep $index -- copy necessary file to  ${node_dir}"
cp -rf "${src_resource_dir}" "${node_dir}"/
cp -f "${work_dir}"/config.json.template "${node_dir}"/
cp -rf "${src_script_dir}" "${node_dir}"/
cp -rf "${src_dir}" "${node_dir}"/
cp -rf "${src_third_party_dir}" "${node_dir}"/
cp -f package.json "${node_dir}"/
cp -f README.md "${node_dir}"/
cp -f tsconfig.json "${node_dir}"/


sleep 1
index=$((index+1))
echo -e "\nstep $index -- generate package file"
pushd "${output_dir}" || exit 2
tar -zcf "${file_name}" "${package_name}"
rm -rf "${package_name}"
popd  || exit 2


index=$((index+1))
echo -e "\nstep $index -- package : ${file_name} under [ ${output_dir} ] is ready. $(date)"
